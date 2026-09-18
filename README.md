# Cove

Your self-hosted personal workspace — 运行在 NAS 上的自托管个人工作台。

## 当前状态

**Self-hosted personal workspace foundation**。当前包含身份与访问管理、审计、SMB 个人文件访问，以及基于 SMB 的私有优先图床。Markdown + Canvas 笔记、应用工具及定时 JS 脚本属于[功能规划](docs/product/roadmap.md)，尚未实现。

## 技术栈

- pnpm workspace + Turborepo + TypeScript
- React + Vite + React Router + TanStack Query
- i18next + react-i18next（中文 / English）
- shadcn/ui 组件约定 + Tailwind CSS
- NestJS + Passport + JWT + class-validator + Permission Guard
- MySQL 8.4 + Prisma ORM 7 + MariaDB Driver Adapter + Prisma Migrate + Argon2id

## 项目结构

```text
apps/
  web/       React 个人工作台
  server/    NestJS API
packages/
  shared/         少量前后端共享 API 类型
  eslint-config/  共享 ESLint 配置
  tsconfig/       共享 TypeScript 配置
docs/             后续设计文档入口
```

## 项目文档与 Spec Coding

长期产品事实、架构边界、领域行为、变更 Spec、质量门槛和发布规则统一维护在 [`docs/README.md`](docs/README.md)。涉及行为、API、数据、安全、部署或外部集成的改动，应先创建并批准 Spec，再按照任务清单实施。

## 安装

Docker 部署见 [`docs/operations/docker.md`](docs/operations/docker.md)；从开发电脑导出镜像并传到威联通的完整流程见 [`docs/operations/nas-manual-deployment.md`](docs/operations/nas-manual-deployment.md)。生产构建使用一个 Cove 应用镜像，由 NestJS 同时提供前端页面和 API；Compose 通过环境变量连接外部 MySQL，不管理数据库容器。以下为本地开发方式。

项目固定使用 Node.js 22.14.0（Prisma 7 最低要求为 Node.js 20.19 / 22.12 / 24.0）：

```powershell
nvm use 22.14.0
corepack enable
```

```bash
pnpm install
```

## 启动

```bash
pnpm dev
```

- Web: http://localhost:5173
- Server: http://localhost:3000

Vite 默认将 `/api` 代理到 NestJS。Server 只读取 `apps/server/.env`，并通过其中的 `DATABASE_URL` 和 Prisma 7 的 `@prisma/adapter-mariadb` 连接 MySQL。

## 数据库

```bash
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
```

`db:seed` 会幂等创建权限目录与 `super_admin`、`administrator`、`viewer` 系统角色。首次创建管理员时显式提供密码：

```powershell
$env:BOOTSTRAP_ADMIN_USERNAME='admin'
$env:BOOTSTRAP_ADMIN_PASSWORD='your-password'
pnpm db:bootstrap-admin
```

## Build 与质量检查

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## 默认开发账号

```text
username: admin
password: admin123
```

> Development only. 当前本地数据库已初始化该开发账号，正式部署时必须使用独立强密码。

## 环境变量

复制 `apps/server/.env.example` 为 `apps/server/.env`，并配置 `DATABASE_URL` 与 `JWT_SECRET`。Prisma、数据库 seed、管理员初始化和 NestJS Server 共用该文件；生产模式必须显式提供强随机密钥。

Web 默认通过 Vite 的 `/api` 代理访问 Server，无需额外配置。需要指定独立 API 地址时，在 `apps/web/.env` 中配置 `VITE_API_URL`。不要把 `JWT_SECRET`、数据库密码等 Server secret 放入 Web 环境变量。
