---
title: 统一本地环境变量文件
status: Completed
owners: []
created: 2026-09-02
updated: 2026-09-02
---

# 统一本地环境变量文件

## 背景与问题

仓库根目录和 `apps/server` 目前各有一份 `.env.example`，Server 启动时也会依次查找 `apps/server/.env` 与根目录 `.env`。但 Prisma、seed 和管理员初始化命令主要以 `apps/server` 为工作目录，根目录文件不能作为这些命令的一致配置来源。两套入口容易产生值不一致和配置实际未生效的问题。

## 目标

- Server 的本地环境变量只从 `apps/server/.env` 加载。
- 示例文件和使用文档与实际加载行为保持一致。
- Web 环境变量仍遵循 Vite 的应用目录约定，不与 Server secret 混放。

## 非目标

- 不引入生产 Secret Provider 或 Docker secret。
- 不改变任何环境变量名称、默认端口或数据库连接格式。
- 不新增前端环境变量。

## 用户场景

### 本地启动 Server

维护者复制 `apps/server/.env.example` 为 `apps/server/.env` 并填写配置后，通过根目录 workspace 命令启动 Server、执行 Prisma 或初始化管理员，所有命令读取同一份配置。

## 功能需求

- `ENV-FR-001`：Server 必须只把 `apps/server/.env` 作为仓库内的本地 dotenv 文件。
- `ENV-FR-002`：Prisma、seed 和管理员初始化命令必须继续读取 `apps/server/.env`。
- `ENV-FR-003`：仓库必须只保留 `apps/server/.env.example` 作为 Server 环境变量示例，并包含当前支持的 Server 与管理员初始化变量。
- `ENV-FR-004`：Web 的 `VITE_*` 变量不得放入 Server 示例文件；需要配置时使用 `apps/web/.env`。

## 非功能需求

- `ENV-NFR-001`：真实 `.env`、数据库密码和 JWT secret 不得进入版本控制。
- `ENV-NFR-002`：README 必须准确说明 Server 与 Web 各自的环境变量文件位置。

## 验收条件

- `ENV-AC-001`：仓库根目录不存在受跟踪的 `.env.example`，`apps/server/.env.example` 包含 `DATABASE_URL`、`JWT_SECRET`、`PORT`、`BOOTSTRAP_ADMIN_USERNAME` 和 `BOOTSTRAP_ADMIN_PASSWORD`。
- `ENV-AC-002`：当根目录 `.env` 与 `apps/server/.env` 同时存在时，NestJS Server 不读取根目录 `.env`。
- `ENV-AC-003`：根目录 README 指示用户复制 `apps/server/.env.example`，并将可选的 `VITE_API_URL` 指向 `apps/web/.env`。
- `ENV-AC-004`：lint、typecheck、build 与环境文件加载的定向验证通过。

## 开放问题

- 无。

## 变更记录

| 日期       | 变更                 | 作者               |
| ---------- | -------------------- | ------------------ |
| 2026-09-02 | 创建 Draft           | Codex              |
| 2026-09-02 | 维护者批准并开始实施 | maintainer / Codex |
| 2026-09-02 | 实现、验证并完成文档 | Codex              |
