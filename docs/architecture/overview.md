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
                         ├──── Prisma 7 ──────────┘
                         └──── Python SMB worker ──► NAS home
```

- Web 负责页面路由、内存页面会话、交互状态、国际化和权限可见性。工作台按顶级 routeId 保持一个挂载实例，活动 URL 仍由 React Router 与权限守卫决定；稳定行为见[页面会话标签](../behavior/page-sessions.md)。
- Server 是认证、授权、业务规则和外部副作用的唯一可信入口。
- Prisma/MySQL 保存长期业务状态；浏览器本地存储仅保存访问令牌和界面偏好。页面会话、表单草稿和组件树不持久化，刷新或认证边界变化会释放。
- `packages/shared` 只放稳定且确有前后端共享价值的契约，不能成为业务逻辑容器。

## 模块边界

当前 Server 是模块化单体。每个业务模块应拥有自己的 controller、service、DTO 和领域适配器，并通过 NestJS 模块显式依赖其他能力。

FilesModule 已通过独立 Python SMB 协议进程连接 NAS，并向 ImagesModule 导出受控的配置、绑定和 SMB 适配基础。该进程按操作启动：每次元数据操作（stat/list/mkdir/rename/delete）都是一个新进程加一次全新的 SMB 会话（TCP + NTLM 认证 + 树连接），本机实测固定开销约 60ms（首次冷启动约 120ms，其中 Python 解释器约 15ms、`smbprotocol` 的 connection/session/tree/open 约 40ms，Node 侧进程派生约 5ms），NAS 往返另计；因此每减少一次操作就有直接收益（Notes 已去掉每次请求重复的根目录校验，见下）。常驻 worker 与会话复用属于后续独立的性能 Spec，不在当前模块范围内。凭据采用 AES-256-GCM 加密保存，文件字节通过管道流式传输；MySQL 保存绑定、恢复状态、一次性下载票据、可重建图片索引和不可复活的公开 grant。NAS 文件与 ACL 为字节事实源，默认单 Server 实例。详见 [Files 行为](../behavior/files.md)、[图床行为](../behavior/images.md)与[运行配置](../operations/files.md)。

ImagesModule 拥有独立 RBAC、图片状态和 `/api/images` 管理 API。匿名 `GET /image/{publicId}` 不经过 SPA fallback 或 JWT，仅在公开 grant、用户、绑定版本、对象身份与文件元数据均有效时流式返回已验证 MIME。单 IP 与全局分钟桶保存在 MySQL，以便跨重启及多 Server 进程共享频率限制。

NotesModule 复用 FilesModule 的 SMB 绑定与适配基础，把每用户 home 下固定的 `Markdown Notes/` 目录作为笔记正文事实源；MySQL 只保存可恢复的 `NoteWriteOperation` 写入状态与脱敏审计，不保存正文。保存使用不透明 revision 令牌与条件原子替换，NAS 上的外部修改视为合法变更并以冲突提示用户裁决。详见 [Notes 行为](../behavior/notes.md)。

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
- 登录入口在 Argon2id 前通过 MySQL 原子预留用户名与来源 IP 的校验额度；失败计数、递增冷却和短期预留跨重启、跨进程共享。可信代理未配置时只使用直接连接地址。
- 限流键通过 `JWT_SECRET` 的独立上下文派生 HMAC；未知用户名在审计中使用另一独立上下文的截断指纹。密码、token、原始未知用户名和派生密钥不进入审计。

稳定的用户行为见 [`../behavior/identity-and-access.md`](../behavior/identity-and-access.md)。

## 部署现状

仓库提供根目录 `Dockerfile` 和 `compose.yaml`：多阶段构建将 Web 静态产物、NestJS Server 和 Python SMB 环境放入一个 Cove 应用镜像，由 NestJS 在同一端口提供页面与 `/api`。Compose 不创建 MySQL 服务或数据库卷，通过 `DATABASE_URL` 连接维护者管理的外部 MySQL。一次性迁移与 seed 服务成功退出后才启动应用；管理员单独初始化。默认只发布应用的宿主机 8080 端口。操作见 [`../operations/docker.md`](../operations/docker.md)。本机 clean-room 已通过；实际 NAS 与旧部署现场验证由维护者延期，证据见[归档 Spec](../specs/archive/2026-09-17-single-application-image/tasks.md)。

## 本地配置边界

- NestJS Server、Prisma、数据库 seed 和管理员初始化共用 `apps/server/.env`；仓库根目录不是 dotenv 配置入口。
- Vite Web 按应用目录读取 `apps/web/.env`。只有 `VITE_*` 变量可进入浏览器构建，Server secret 不得放入 Web 环境变量。
- 实际 `.env` 文件不得提交；`apps/server/.env.example` 是 Server 环境变量的受跟踪示例。
- 生产镜像设置 `WEB_STATIC_ROOT=/app/public` 以启用静态页面；本地开发不设置该变量，继续由 Vite 提供 Web。
- Compose 显式使用 `--env-file apps/server/.env` 读取部署变量，并按服务注入环境变量；镜像不包含实际 dotenv 文件。`DATABASE_URL` 必须使用应用容器可访问的外部数据库地址，容器内的 `127.0.0.1` 不代表 NAS 宿主机。
