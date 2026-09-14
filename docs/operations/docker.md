# Docker Compose 部署

## 准备

使用 Docker Engine / Docker Desktop 与 Docker Compose v2，在仓库根目录执行以下命令。部署会构建 Web、Server 镜像，并启动 MySQL 8.4。只有 Web 默认映射到宿主机 8080；API 和数据库仅在 Compose 网络内访问。

```sh
cp apps/server/.env.example apps/server/.env
```

已有 `.env` 时直接编辑，不要覆盖。填写：

- `MYSQL_PASSWORD`：数据库应用用户的强随机密码。
- `MYSQL_ROOT_PASSWORD`：不同的数据库 root 强随机密码。
- `DATABASE_URL`：`mysql://home_ops:密码@mysql:3306/home_ops?allowPublicKeyRetrieval=true`，密码与 `MYSQL_PASSWORD` 一致。URL 中密码必须百分号编码；使用随机十六进制密码可以避免编码问题。
- `JWT_SECRET`：独立的强随机密钥，例如使用 `openssl rand -hex 32` 生成。
- `HOME_OPS_VERSION`：本次部署的唯一版本标签，例如 Git 提交短哈希，避免覆盖可回滚的旧镜像。
- `WEB_PORT`：可选，默认 8080。

包含 `$` 等特殊字符的 dotenv 值使用单引号包裹，避免 Compose 插值。不要提交实际 `.env`。修改 MySQL 初始化变量不会更改已有数据卷中的账号密码；已有数据库改密必须先在数据库执行，再同步连接配置。

后续命令用以下 shell 函数统一指定配置文件；PowerShell 用户可将 `dc` 替换成完整的 `docker compose --env-file apps/server/.env`：

```sh
dc() { docker compose --env-file apps/server/.env "$@"; }
dc config --quiet
dc up -d --build --wait
dc ps -a
```

`migrate` 成功退出是正常状态。它在数据库健康后执行迁移与 RBAC seed，成功后才启动 Server 和 Web。构建不连接业务数据库，也不读取实际 `.env`。缺少必要变量时配置校验失败。不要保存或分享未加 `--quiet` 的展开配置，它包含运行时凭据。

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
dc logs --tail=100 migrate server web
dc restart server web
dc down
```

MySQL 探测应用用户执行 `SELECT 1`；Server 探测匿名请求 `/api/auth/me` 返回 401，表示 HTTP 与认证入口可用，不代表持续的数据库连通性检查；Web 探测静态首页。`unless-stopped` 在进程退出后重启长期服务，健康状态本身不会触发重启。

`dc down` 保留数据库命名卷，下次 `dc up -d --wait` 恢复数据。不要使用 `down -v`，它会删除数据库卷。保持项目名和部署目录约定稳定，避免误用另一项目的空卷。

迁移失败时查看 `migrate` 日志并修复原因，再执行 `dc up -d --wait`。不要以手动启动 API 绕过失败的迁移。常规重启不执行管理员初始化。

## 备份与恢复

备份文件包含业务数据，存放到仓库外的受保护目录。以下示例适用于 POSIX shell：

```sh
umask 077
backup="$HOME/home-ops-backup-$(date +%Y%m%d-%H%M%S).sql"
dc exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -u root --single-transaction --no-tablespaces --set-gtid-purged=OFF home_ops' > "$backup"
test -s "$backup"
```

命令失败时丢弃不完整备份；文件非空不等于备份可恢复，更新前必须在隔离环境执行恢复并验证数据。

恢复会覆盖同名表中的数据。先停止流量和 API、备份当前数据库，确认选中了目标部署和正确备份，再执行：

```sh
dc stop web server
dc exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root home_ops' < "$backup"
dc up -d --wait
```

若新版本增加了备份中不存在的表，导入旧备份不会自动删除这些表；应恢复到隔离的新数据库卷，验证后再切换，不能直接将旧备份覆盖当作完整 schema 降级。

## 更新与回滚

记录旧 `HOME_OPS_VERSION`、源代码版本和数据库备份位置，保留对应 Web/Server 镜像。修改 `.env` 为新的唯一版本标签，然后：

```sh
dc build server web
dc stop web server
dc rm -f migrate
dc up -d --wait
```

更新流程有短暂停机窗口；删除已退出的 `migrate` 容器可保证重新执行迁移与 seed。初始化失败时 API 保持停止，修复后重试。

数据库 schema 兼容旧应用时，将 `HOME_OPS_VERSION` 改回旧标签，并使用对应版本的 Compose 配置：

```sh
dc stop web server
dc rm -f migrate
dc up -d --no-build --pull never --wait
```

回滚前确保旧镜像仍存在；不要重新构建覆盖旧标签。更换应用镜像不会撤销数据库迁移。若 schema 不兼容，应按上面的隔离恢复方式还原更新前备份，并接受备份之后写入的数据需要另行处理。

Compose 启动依赖语义参考 [Docker 官方文档](https://docs.docker.com/compose/how-tos/startup-order/)。

## 可选 Files 集成

SMB 连接、Python 依赖、上传代理和密钥轮换说明见 [Files 配置](files.md)。Compose 仅向 server 注入相关密钥；Docker Files 完整运行验收本轮按维护者要求跳过。
