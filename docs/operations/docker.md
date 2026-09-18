# Docker Compose 部署

需要在开发电脑构建镜像并以文件方式传到威联通时，使用[威联通 NAS 手动部署指南](nas-manual-deployment.md)。

## 准备

使用 Docker Engine / Docker Desktop 与 Docker Compose v2，在仓库根目录执行以下命令。部署只构建和运行包含 Web、Server 与 SMB 环境的 Cove 应用镜像，不创建 MySQL 容器或数据卷。应用默认映射到宿主机 8080。

部署前先在 NAS 或其他受管理环境准备兼容的 MySQL、`cove` 数据库和最小权限应用账号。数据库必须允许 Cove 容器访问；连接地址不能填写容器自身的 `127.0.0.1`。可以使用 NAS 的局域网地址、容器可解析的主机名，或已加入同一外部 Docker 网络的数据库服务名。

```sh
cp apps/server/.env.example apps/server/.env
```

已有 `.env` 时直接编辑，不要覆盖。填写：

- `DATABASE_URL`：完整的外部数据库连接，例如 `mysql://cove:密码@NAS_OR_DB_HOST:3306/cove?allowPublicKeyRetrieval=true`。URL 中的用户名、密码和主机必须百分号编码；使用随机十六进制密码可以减少编码问题。
- `JWT_SECRET`：独立的强随机密钥，例如使用 `openssl rand -hex 32` 生成。
- `COVE_VERSION`：本次部署的唯一版本标签，例如 Git 提交短哈希，避免覆盖可回滚的旧镜像。
- `WEB_PORT`：可选，默认 8080。
- 登录防护默认按用户名 5 次、IP 20 次失败触发递增冷却，`apps/server/.env.example` 中的 `AUTH_LOGIN_*` 可在给定安全边界内调整。非法值会阻止 Server 启动，不能用 0 关闭。
- `AUTH_TRUSTED_PROXY_CIDRS`：可选的逗号分隔代理 CIDR。留空时忽略全部转发 IP 头；只有 Cove 前确实存在受控反向代理时填写其实际网段，不要填 `*` 或客户端网段。

包含 `$` 等特殊字符的 dotenv 值使用单引号包裹，避免 Compose 插值。不要提交实际 `.env`。数据库账号、网络访问、备份、恢复和升级由外部 MySQL 的维护流程负责；已有数据库改密必须先在数据库执行，再同步 `DATABASE_URL`。

后续命令用以下 shell 函数统一指定配置文件；PowerShell 用户可将 `dc` 替换成完整的 `docker compose --env-file apps/server/.env`：

```sh
dc() { docker compose --env-file apps/server/.env "$@"; }
dc config --quiet
dc up -d --build --wait
dc ps -a
```

`migrate` 成功退出是正常状态。它直接连接 `DATABASE_URL` 指向的外部数据库并执行迁移与 RBAC seed，成功后才启动应用。数据库不可达、凭据错误或迁移失败时，应用不会启动。`migrate` 和 `bootstrap-admin` 复用同一个 Cove 镜像，但不启动 HTTP 服务。构建不连接业务数据库，也不读取实际 `.env`。缺少必要变量时配置校验失败。不要保存或分享未加 `--quiet` 的展开配置，它包含运行时凭据。

## 首次管理员

在 `apps/server/.env` 中填写 `BOOTSTRAP_ADMIN_USERNAME` 和独立强密码 `BOOTSTRAP_ADMIN_PASSWORD`，然后执行：

```sh
dc run --rm bootstrap-admin
```

完成后清空 `.env` 中的 `BOOTSTRAP_ADMIN_PASSWORD`。该密码只注入显式初始化容器，不进入常驻 API 容器。脚本发现已有超级管理员时跳过创建，不重置密码。访问 `http://localhost:8080`，使用刚设置的账号登录。

远程访问时使用宿主机地址及实际 `WEB_PORT`。需要 HTTPS 时接入已有反向代理；此配置不自动申请证书。

## 健康与停止

```sh
dc ps -a
dc logs --tail=100 migrate server
dc restart server
dc down
```

应用健康检查同时要求静态首页返回 HTML 200，且匿名请求 `/api/auth/me` 返回 401。这表示页面与认证入口可用，不代表持续的数据库或 SMB 连通性检查；外部 MySQL 应有独立监控。`unless-stopped` 在进程退出后重启长期服务，健康状态本身不会触发重启。

登录限流状态位于外部 MySQL，重启应用不会解除有效冷却。JWT 密钥轮换会使旧会话失效，同时改变限流 HMAC 键；旧限流行会在保留期后批量清理。回滚到不支持登录限流的旧版本时，新表可保留，但回滚期间应依靠外部访问控制限制登录暴露。

`dc down` 只删除 Cove 项目的容器和默认网络，不会删除或停止外部数据库。保持项目名和部署目录约定稳定。

迁移失败时查看 `migrate` 日志并修复原因，再执行 `dc up -d --wait`。不要以手动启动 API 绕过失败的迁移。常规重启不执行管理员初始化。

## 备份与恢复

Compose 不包含数据库客户端，也不管理数据库备份。发布前必须通过 NAS 数据库应用、托管服务或 MySQL 原生工具创建一致性备份，并在隔离数据库验证恢复。备份文件和 `SMB_CREDENTIAL_KEY` 应分别保存在仓库外的受保护位置。

恢复会覆盖业务状态。先执行 `dc stop server` 停止写入，再按外部数据库的恢复流程还原到隔离数据库；验证 schema、用户、SMB 绑定和关键 API 后更新 `DATABASE_URL` 并执行 `dc up -d --wait`。若新版本增加了旧备份不存在的表，不能把直接覆盖现有数据库当作完整 schema 降级。

## 更新与回滚

记录旧 `COVE_VERSION`、源代码版本和数据库备份位置，保留对应 Cove 应用镜像。修改 `.env` 为新的唯一版本标签，然后：

从包含 Web、Server 和 MySQL 的旧 Compose 首次升级时，还要保留旧 Compose、两个旧应用镜像、数据库备份和旧 `mysql-data` 卷。先把旧数据库完整迁移到外部 MySQL 并验证恢复，再用旧配置执行 `dc down`；不要使用 `down -v`。随后切换代码、Compose 和 `DATABASE_URL`，由新 server 接管 8080 端口。不要依赖新 Compose 自动清理已删除的 web 和 mysql 服务，也不要在外部数据库验收前删除旧卷。

```sh
dc build server
dc stop server
dc rm -f migrate
dc up -d --wait
```

更新流程有短暂停机窗口；删除已退出的 `migrate` 容器可保证重新执行迁移与 seed。初始化失败时 API 保持停止，修复后重试。

数据库 schema 兼容旧应用时，将 `COVE_VERSION` 改回旧标签，并使用对应版本的 Compose 配置：

```sh
dc stop server
dc rm -f migrate
dc up -d --no-build --pull never --wait
```

回滚前确保旧镜像仍存在；不要重新构建覆盖旧标签。更换应用镜像不会撤销数据库迁移。若 schema 不兼容，应按上面的隔离恢复方式还原更新前备份，并接受备份之后写入的数据需要另行处理。

Compose 启动依赖语义参考 [Docker 官方文档](https://docs.docker.com/compose/how-tos/startup-order/)。

## 可选 Files 集成

SMB 连接、外部 HTTPS 代理和密钥轮换说明见 [Files 配置](files.md)。Compose 仅向 server 注入相关密钥；单应用镜像的实际 NAS Files 验收由维护者延期至首次生产部署，状态见[归档任务记录](../specs/archive/2026-09-17-single-application-image/tasks.md)。

## 命名约定

产品与仓库名称为 Cove，镜像和默认 Compose 项目名为 `cove`。镜像版本只读取 `COVE_VERSION`，未设置或为空时使用 `local`，不读取其他品牌的版本变量。真实环境文件与已有数据库账号由部署者维护，改名不自动修改数据库、凭据或 NAS 文件。
