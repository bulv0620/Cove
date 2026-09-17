# 技术设计

## 设计摘要

本文件描述计划行为。以根目录 Dockerfile 统一构建 Web 和 Server，最终镜像由 NestJS 提供静态页面与 API；保留现有 server 服务名以减少运维变化。移除旧 Web/Server Dockerfile 和 deploy/nginx.conf 前检查全部引用，更新构建入口。

```text
Browser → 可选外部 HTTPS 反向代理 → server:3000
                                  ├── 前端静态文件
                                  ├── /api → 外部 MySQL
                                  └── Python SMB → NAS
```

## 组件与边界

- 多阶段构建分别编译 Web 和 Server，使用锁文件安装依赖；最终镜像仅将 Web dist 复制到 `/app/public`，保留 Server 运维命令所需文件、Prisma migrations 和 `/opt/smb`。
- 采用显式运行变量 `WEB_STATIC_ROOT=/app/public` 启用静态服务，由镜像设置；未配置时不注册静态服务，兼容本地开发。配置后目录或 index.html 缺失则启动失败。
- 静态处理限定在公共根目录，关闭 dotfile、目录列表及目录外访问；不将 Server 工作目录作为静态目录。
- `/api` 和 `/api/…` 优先且无条件排除出静态处理。资源命中先返回资源；`/assets/…` 和具有文件扩展名的缺失路径返回 404。其余 GET/HEAD 且接受 HTML 的页面请求可以返回入口文件；其它方法交回正常 404/405 路径。
- 入口 HTML 使用 `Cache-Control: no-cache`；Vite 内容哈希资源使用长期 immutable 缓存，其余公共文件重新验证。前端路由新增含扩展名路径时需重新审查兜底规则。

## 数据模型与 API 契约

无 schema 变更，不改变 API 前缀、响应、JWT、权限或 cookie 契约。静态页面本身可公开获取，所有业务数据仍由 API 守卫保护。前端继续请求同源 `/api`。

## 状态与失败恢复

migrate 启动后直接通过 `DATABASE_URL` 连接外部 MySQL 并执行 migration deploy 与 seed，成功后 server 启动。数据库不可达或迁移失败时 migrate 非零退出，server 保持未启动。健康检查同时获取首页和匿名 `/api/auth/me`，分别期待 200 HTML 与 401；不将此描述为持续数据库检测。健康状态本身不会触发 Docker 自动重启，进程退出沿用 unless-stopped。

保持 init、非 root 和关闭钩子，让 Node 与 SMB 子进程沿用现有取消、租约和中断恢复机制。初始化失败保留日志并停止升级，不绕过依赖手动启动应用。

## 安全与传输

仅 server 注入 JWT 和 SMB 密钥；migrate 只获取数据库配置，bootstrap-admin 额外获取初始化凭据。构建不读取实际 env、不连接业务数据库，继续排除 secret/dump，并保留 SQL 迁移。

移除 Nginx 后浏览器文件流直接进入现有 Server：保持 requestTimeout=0、请求头超时、空闲超时和实际字节计数，不为上传引入通用整包 body parser。原 Nginx 没有额外静态缓存策略，新缓存头属于本次显式定义。

生产 Files 下载仍要求外部 HTTPS 入口；合并镜像不自动终止 TLS。核对外部代理对协议头、Secure cookie、上传大小和缓冲的影响；不无条件信任客户端伪造的转发头，不扩大 trust proxy 边界。实际代理部署记录在验收环境中。

## 本地开发与生产部署

本地 pnpm dev、Vite 5173 → API 3000 和 apps/server/.env 入口保持不变。Compose 仍显式使用 `--env-file apps/server/.env`，统一镜像本轮仍由源码构建；纯拉取镜像部署及发布流水线另立 Spec。

Compose 不包含 MySQL 服务或数据库卷。外部数据库必须兼容项目当前 MySQL 版本要求，并允许应用容器网络访问；`DATABASE_URL` 不能使用只指向容器自身的 `127.0.0.1`，应使用 NAS 地址、可解析主机名或外部 Docker 网络中的服务名。应用镜像命名为 home-ops，默认本地标签 local；实际升级使用唯一 HOME_OPS_VERSION。WEB_PORT 保持默认 8080，对外仅映射 server 的 3000，健康检查使用容器内部端口。

## 迁移与兼容性

1. 记录旧版本、旧 Compose 和旧 Web/Server 镜像；备份数据库及独立 SMB 密钥，在隔离环境验证恢复。
2. 旧部署若使用 Compose MySQL，先准备外部数据库，通过数据库原生工具迁移并验证用户、绑定和操作记录；在切换完成前保留旧卷及备份。
3. 用旧配置停止旧应用，切换 Compose 与 `DATABASE_URL`，移除旧 migrate 容器以重新执行迁移与 seed；启动并等待健康。seed 可能使旧会话失效，用户需重新登录。
4. 验证用户、绑定及文件功能；出现失败停止新应用，用保留的旧 Compose、镜像和数据库恢复方案回滚。禁止删除尚未完成迁移验收的旧卷，禁止通过新构建覆盖旧标签。

本次不新增迁移，但仍需检验升级链已有迁移的兼容性。镜像回滚不撤销 schema，也不撤销 NAS 文件变化；不兼容 schema 需要隔离恢复旧数据库并明确后续写入处理，沿用现有恢复边界。

## 可观测性

应用日志统一由 server 输出，迁移与初始化仍有独立任务日志；记录静态入口缺失、启动失败和健康状态，不记录凭据。证据包含镜像版本、架构、Docker/Compose 版本和目标 NAS 环境。

## 备选方案

- 同镜像运行 Nginx 与 Node：可以保留代理配置，但需要维护多个常驻服务的启动、退出和健康语义，本次不采用。
- 继续双镜像：现有方案可继续使用，但不满足本次单应用镜像目标。

## 待决策项

NAS 环境信息按 spec.md 在运行验收前确认；本设计不预先承诺 amd64/arm64 均通过验证。
