# 架构概览

## 当前仓库结构

Home Ops 使用 pnpm workspace 与 Turborepo 管理 TypeScript 单仓库：

```text
apps/
  web/       React + Vite 管理界面
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

新增基础设施模块时遵循：

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

当前仓库尚未提供生产 Docker Compose 文件。根目录 `README.md` 记录的是本地开发启动方式。在生产部署拓扑正式实现前，任何容器、卷、网络或 sidecar 设计都属于 Spec 内容而非当前架构事实。

## 本地配置边界

- NestJS Server、Prisma、数据库 seed 和管理员初始化共用 `apps/server/.env`；仓库根目录不是 dotenv 配置入口。
- Vite Web 按应用目录读取 `apps/web/.env`。只有 `VITE_*` 变量可进入浏览器构建，Server secret 不得放入 Web 环境变量。
- 实际 `.env` 文件不得提交；`apps/server/.env.example` 是 Server 环境变量的受跟踪示例。
