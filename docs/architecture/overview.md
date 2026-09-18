# 架构概览

## 当前仓库结构

Cove 使用 pnpm workspace 与 Turborepo 管理 TypeScript 单仓库：

```text
apps/
  web/       React + Vite 个人工作台
  server/    NestJS API 与后台业务逻辑
packages/
  shared/    前后端共享类型
  eslint-config/
  tsconfig/
docs/        长期事实、Spec、质量与运维文档
```

## 当前运行时边界

```text
Browser
  │ HTTP /api + JWT
  ▼
React Web ──────────► NestJS Server ──────────► MySQL 8.4
                         │                         ▲
                         └──── Prisma 7 ──────────┘
```

- Web 负责页面路由、交互状态、国际化和权限可见性。
- Server 是认证、授权、业务规则和外部副作用的唯一可信入口。
- Prisma/MySQL 保存长期业务状态；浏览器本地存储仅保存访问令牌和界面偏好。
- `packages/shared` 只放稳定且确有前后端共享价值的契约，不能成为业务逻辑容器。

## 模块边界

当前 Server 是模块化单体。每个业务模块应拥有自己的 controller、service、DTO 和领域适配器，并通过 NestJS 模块显式依赖其他能力。

FilesModule 已通过独立 Python SMB 协议进程连接 NAS。凭据采用 AES-256-GCM 加密保存，文件字节通过管道流式传输；MySQL 保存绑定、上传状态和一次性下载票据。NAS 文件与 ACL 为文件事实源，默认单 Server 实例。详见 [Files 行为](../behavior/files.md) 与 [运行配置](../operations/files.md)。

新增功能模块时遵循：

- Controller 只处理传输协议、鉴权声明和输入转换。
- Service 负责用例编排与事务边界。
- 外部命令、文件写入和进程控制必须位于可替换的 adapter 后面。
- 定时协调和长时间操作不得阻塞 HTTP 请求；通过持久化 operation/job 状态异步执行。
- 外部系统的实际状态不能只存在于进程内存中。

## 身份与授权

- 受保护 API 默认经过 JWT 与权限守卫。
- 页面权限控制路由和导航可见性；动作权限控制创建、更新、部署、重载等操作。
- `isSuperAdmin` 是平台级绕过机制，不等同于普通角色。
- Server 必须独立执行授权，前端隐藏按钮不能替代后端鉴权。

稳定的用户行为见 [`../behavior/identity-and-access.md`](../behavior/identity-and-access.md)。

## 部署现状

仓库提供根目录 `Dockerfile` 和 `compose.yaml`：多阶段构建将 Web 静态产物、NestJS Server 和 Python SMB 环境放入一个 Cove 应用镜像，由 NestJS 在同一端口提供页面与 `/api`。Compose 不创建 MySQL 服务或数据库卷，通过 `DATABASE_URL` 连接维护者管理的外部 MySQL。一次性迁移与 seed 服务成功退出后才启动应用；管理员单独初始化。默认只发布应用的宿主机 8080 端口。操作见 [`../operations/docker.md`](../operations/docker.md)。本机 clean-room 已通过；实际 NAS 与旧部署现场验证由维护者延期，证据见[归档 Spec](../specs/archive/2026-09-17-single-application-image/tasks.md)。

## 本地配置边界

- NestJS Server、Prisma、数据库 seed 和管理员初始化共用 `apps/server/.env`；仓库根目录不是 dotenv 配置入口。
- Vite Web 按应用目录读取 `apps/web/.env`。只有 `VITE_*` 变量可进入浏览器构建，Server secret 不得放入 Web 环境变量。
- 实际 `.env` 文件不得提交；`apps/server/.env.example` 是 Server 环境变量的受跟踪示例。
- 生产镜像设置 `WEB_STATIC_ROOT=/app/public` 以启用静态页面；本地开发不设置该变量，继续由 Vite 提供 Web。
- Compose 显式使用 `--env-file apps/server/.env` 读取部署变量，并按服务注入环境变量；镜像不包含实际 dotenv 文件。`DATABASE_URL` 必须使用应用容器可访问的外部数据库地址，容器内的 `127.0.0.1` 不代表 NAS 宿主机。
