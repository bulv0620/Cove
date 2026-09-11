# 技术设计

## 计划拓扑

浏览器 → Web 静态服务器（宿主机默认 8080）→ Server（内部 3000）→ MySQL 8.4（内部 3306）。Web 使用 Nginx，提供 SPA fallback，代理保留 `/api` 前缀。数据库和 API 不发布宿主机端口。HTTPS 由部署者现有反向代理提供。

## 构建与运行

计划新增 `apps/web/Dockerfile`、`apps/server/Dockerfile`、`deploy/nginx.conf`、根目录 `compose.yaml` 和 `.dockerignore`。以仓库根目录为构建上下文，固定兼容的 Node 镜像与仓库指定 pnpm 9.12.2，使用 frozen lockfile。Prisma generate 使用非敏感构建占位 URL，不连接生产数据库。实施时验证实际 Nest 编译输出、共享包路径和 Prisma/argon2 运行依赖后确定复制清单。

Server 镜像保留迁移、seed 和 bootstrap-admin 所需工具，供一次性初始化任务复用；运行服务使用编译产物和非 root 用户。Web 最终镜像仅包含静态资源和代理配置。

## 配置与密钥

扩展现有 `apps/server/.env.example`，区分本地与 Docker 配置值，加入 Compose 所需 MySQL 密码和可选 Web 端口、应用镜像版本。Docker 模式下 `DATABASE_URL` 指向 Compose 数据库服务名，凭据须与 MySQL 初始化变量一致，并说明 URL 编码要求。应用仍以包目录为工作目录，通过容器环境读取配置。

Compose 对必要变量使用必填约束；仅将各服务所需变量注入对应服务。管理员初始化密码仅供显式的一次性命令使用。Web 构建不读取 Server 环境；`.dockerignore` 排除所有真实 dotenv 文件及敏感、本地生成内容。

## 启动、健康与失败恢复

MySQL 健康检查通过后，一次性初始化服务顺序执行 `prisma migrate deploy` 和 RBAC seed；Server 依赖该服务成功完成。管理员由维护者单独执行 bootstrap-admin。长期服务设置重启策略；Server 使用进程内 HTTP 探测现有 API 路由的预期状态码，Web 探测静态入口，避免新增业务 API。健康检查的准确含义在部署说明中列明。

MySQL 保存到命名卷，普通停止命令不删除卷。迁移失败保留数据库并停止后续启动；修复和重新执行必须显式操作。更新前备份并验证恢复；应用回滚指定上一镜像版本，涉及不兼容 schema 时先按备份恢复流程处理，禁止把降级镜像描述成数据库回滚。

## 兼容性与验证

不改变本地 Vite 代理、Server dotenv 路径或业务逻辑。记录 clean-room 构建启动、健康、失败路径、重启、持久化与备份回滚证据。实现完成后同步 README、架构、产品定义和发布文档，再标记 Completed。
