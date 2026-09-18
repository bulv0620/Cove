# 威联通 NAS 手动部署

本文说明如何在开发电脑构建 Cove 镜像，将镜像文件传到威联通 NAS，并通过 Docker Compose 使用外部 MySQL 手动部署。该流程不依赖镜像仓库，适合首次部署、内网环境和低频更新。

命令以启用了 Container Station 和 SSH 的威联通 NAS 为例。不同机型的共享目录可能不是 `/share/Container`，请替换为实际路径。当前配置已在本机 Docker ARM64 环境验证；实际 NAS、HTTPS 和 SMB 大文件验收状态见[归档 Spec](../specs/archive/2026-09-17-single-application-image/tasks.md)。

## 1. 部署前准备

NAS 需要具备：

- Container Station、Docker Compose v2 和 SSH 访问。
- 一个从 Cove 容器可访问的外部 MySQL 数据库。
- 未被占用的 Web 端口，默认使用 8080。
- 若启用 Files，容器可以访问 NAS SMB TCP 445。

先通过 NAS SSH 确认 CPU 架构和 Compose：

```sh
uname -m
docker compose version
```

架构对应关系：

| `uname -m` 结果 | 镜像平台      |
| --------------- | ------------- |
| `x86_64`        | `linux/amd64` |
| `aarch64`       | `linux/arm64` |

外部 MySQL 必须预先创建 `cove` 数据库和应用账号，并允许来自 Docker 网段的连接。若 MySQL 也运行在 NAS Docker 中，可以将其端口映射到 NAS 局域网地址，然后在 `DATABASE_URL` 中使用 NAS IP；也可以将两个 Compose 项目加入同一个外部 Docker 网络并使用数据库服务名。不要使用应用容器中的 `127.0.0.1` 指向 NAS 或另一个容器。

部署或升级前，通过外部数据库自己的管理方式完成备份并验证可恢复。数据库备份不由 Cove Compose 管理。

## 2. 在开发电脑构建镜像

在仓库根目录选择唯一版本号。以下示例使用 `0.1.0`，NAS 为 x86_64：

```sh
docker buildx build \
  --platform linux/amd64 \
  --tag cove:0.1.0 \
  --load \
  .
```

ARM64 NAS 将平台替换为 `linux/arm64`。`--load` 只适用于单平台构建，它会把构建结果载入本地 Docker，以便随后导出。

确认镜像存在：

```sh
docker image inspect cove:0.1.0 \
  --format '{{.Os}}/{{.Architecture}} user={{.Config.User}}'
```

预期运行用户为 `node`，架构与 NAS 一致。

## 3. 导出并传输镜像

导出并压缩镜像：

```sh
docker save cove:0.1.0 | gzip > cove-0.1.0.tar.gz
shasum -a 256 cove-0.1.0.tar.gz > cove-0.1.0.tar.gz.sha256
```

将以下文件通过 SMB、File Station 或 `scp` 放入 NAS 部署目录：

```text
/share/Container/cove/
├── compose.yaml
├── .env
├── cove-0.1.0.tar.gz
└── cove-0.1.0.tar.gz.sha256
```

NAS 使用 `sha256sum` 时，可以这样校验：

```sh
cd /share/Container/cove
sha256sum -c cove-0.1.0.tar.gz.sha256
```

如果开发电脑生成的校验文件包含不同路径，直接比较两端输出的 SHA-256 值。

## 4. 在 NAS 导入镜像

```sh
cd /share/Container/cove
gunzip -c cove-0.1.0.tar.gz | docker load
docker image inspect cove:0.1.0 \
  --format '{{.Os}}/{{.Architecture}} user={{.Config.User}}'
```

导入后的标签必须与 `.env` 中的 `COVE_VERSION` 完全一致。

## 5. 创建生产环境变量

在 NAS 部署目录创建 `.env`。不要把它提交到 Git，也不要与镜像文件一起公开分享。

```dotenv
COVE_VERSION=0.1.0
WEB_PORT=8080

DATABASE_URL='mysql://cove:URL编码后的密码@192.168.1.100:3306/cove?allowPublicKeyRetrieval=true'
JWT_SECRET=替换为独立的长随机密钥

BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=

SMB_ENABLED=false
SMB_HOST=192.168.1.100
SMB_PORT=445
SMB_SHARE=home
SMB_DOMAIN=
SMB_ENCRYPTION_REQUIRED=true

SMB_CREDENTIAL_KEY_ID=v1
SMB_CREDENTIAL_KEY=
SMB_CREDENTIAL_PREVIOUS_KEYS={}
SMB_CONNECT_TIMEOUT_MS=10000
SMB_IO_IDLE_TIMEOUT_MS=60000
FILES_MAX_UPLOAD_BYTES=10737418240
FILES_MAX_ACTIVE_PER_USER=2
FILES_MAX_ACTIVE_GLOBAL=8
FILES_MAX_QUEUED_PER_USER=100
FILES_MAX_DIRECTORY_ENTRIES=50000
FILES_DIRECTORY_TIMEOUT_MS=30000
```

生成独立密钥：

```sh
openssl rand -hex 32
openssl rand -base64 32
```

第一条结果用于 `JWT_SECRET`。启用 SMB Files 时，第二条结果用于 `SMB_CREDENTIAL_KEY`；两个密钥不能相同。MySQL 密码中的 `@`、`:`、`/`、`#`、`%` 等字符必须在 `DATABASE_URL` 中进行百分号编码。dotenv 中包含 `$` 等特殊字符的完整 URL 应保留单引号。

默认要求 SMB3 加密。如果威联通只协商签名连接，应在确认局域网风险后设置：

```dotenv
SMB_ENCRYPTION_REQUIRED=false
```

限制环境文件权限：

```sh
chmod 600 .env
```

## 6. 首次启动

先检查 Compose 展开是否有效。必须使用 `--quiet`，避免把连接字符串和密钥打印到终端或日志：

```sh
docker compose --env-file .env config --quiet
```

使用已经导入的镜像启动，禁止在 NAS 上重新构建或隐式拉取：

```sh
docker compose --env-file .env \
  up -d --no-build --pull never --wait
```

启动顺序为：

1. `migrate` 连接外部 MySQL，执行 Prisma migration 和 RBAC seed。
2. `migrate` 成功退出后，`server` 才会启动。
3. 静态首页和匿名认证入口通过健康检查后，Compose 返回成功。

查看状态和日志：

```sh
docker compose --env-file .env ps -a
docker compose --env-file .env logs --tail=100 migrate server
```

`migrate` 显示 `Exited (0)` 是正常状态。数据库不可达、凭据错误或迁移失败时，`server` 不会启动；应先处理迁移日志，不能绕过迁移手动启动应用。

浏览器访问：

```text
http://NAS局域网地址:8080
```

Files 下载在生产模式要求 HTTPS。正式使用 Files 前，应通过已有反向代理为该地址配置 HTTPS，并确保代理不缓冲上传和下载。

## 7. 初始化管理员

首次部署时，临时在 `.env` 填写强密码：

```dotenv
BOOTSTRAP_ADMIN_PASSWORD=一次性填写的强密码
```

执行：

```sh
docker compose --env-file .env run --rm bootstrap-admin
```

脚本发现已有平台超级管理员时会跳过，不会重置密码。成功后立即清空 `.env`：

```dotenv
BOOTSTRAP_ADMIN_PASSWORD=
```

## 8. 手动升级

在开发电脑使用新标签构建和导出，例如 `0.1.1`，上传后在 NAS 导入：

```sh
gunzip -c cove-0.1.1.tar.gz | docker load
docker image inspect cove:0.1.1
```

先备份外部数据库并记录旧标签，然后将 `.env` 改为：

```dotenv
COVE_VERSION=0.1.1
```

执行：

```sh
docker compose --env-file .env config --quiet
docker compose --env-file .env stop server
docker compose --env-file .env rm -f migrate
docker compose --env-file .env \
  up -d --no-build --pull never --wait
```

删除已退出的旧 `migrate` 容器可保证新镜像重新检查并执行待处理迁移。Prisma 根据外部数据库的 `_prisma_migrations` 记录跳过已完成迁移，不会清空现有业务数据。

升级后验证登录、用户、角色、Files 和关键 API，再考虑删除旧镜像。不要使用宽泛的镜像清理命令；确认无需回滚后按明确标签删除：

```sh
docker image rm cove:0.1.0
```

## 9. 回滚

数据库 schema 与旧应用兼容时，把 `.env` 中的版本改回旧标签：

```dotenv
COVE_VERSION=0.1.0
```

然后执行：

```sh
docker compose --env-file .env stop server
docker compose --env-file .env rm -f migrate
docker compose --env-file .env \
  up -d --no-build --pull never --wait
```

更换镜像不会撤销已经执行的数据库迁移，也不会撤销 NAS 文件变化。如果新 schema 与旧应用不兼容，应停止应用，按外部 MySQL 的恢复流程还原升级前备份，在隔离环境验证后再切换 `DATABASE_URL`。

## 10. 常见问题

### 镜像架构错误

出现 `exec format error` 时，通常是镜像平台与 NAS 不一致。重新按 `uname -m` 对应的平台构建并导入。

### Compose 尝试构建或拉取镜像

确认启动命令同时包含：

```text
--no-build --pull never
```

并确认 `COVE_VERSION` 与 `docker image ls cove` 中的标签一致。

### 数据库连接失败

检查 `DATABASE_URL` 中的地址是否能从容器访问、数据库端口是否映射、MySQL 是否监听外部接口，以及用户是否允许来自 Docker 网段的连接。NAS 宿主机上的数据库不能用应用容器的 `127.0.0.1` 表示。

### 端口冲突

修改 `.env` 中的宿主机端口，例如：

```dotenv
WEB_PORT=18080
```

容器内部仍使用 3000，不需要修改。

### 停止应用

```sh
docker compose --env-file .env down
```

该命令只删除 Cove 容器和默认网络，不会停止或删除外部 MySQL。
