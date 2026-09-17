# 实施任务

> Spec 已获维护者批准并进入实施。

## 阶段 0：批准条件

- [x] 维护者确认单应用镜像方案并将 Spec 改为 In Progress（需求：`IMG-FR-001`；验证：2026-09-17 会话批准及 spec.md 状态）。
- [x] 审查静态/API 边界、迁移和回滚设计（需求：`IMG-FR-002`、`IMG-FR-003`、`IMG-FR-005`、`IMG-NFR-001`、`IMG-NFR-002`；验证：2026-09-17 Spec 获批，实施按设计完成）。

## 阶段 1：实现

- [x] 添加统一多阶段 Dockerfile，清理旧入口与引用（需求：`IMG-FR-001`、`IMG-NFR-001`；验证：arm64 干净构建成功，镜像内容及非 root 检查通过）。
- [x] 添加显式静态目录配置、启动校验、路由兜底与缓存头（需求：`IMG-FR-002`、`IMG-FR-003`、`IMG-FR-007`；验证：17 项 Server 测试通过；容器 HTTP 检查覆盖页面、HEAD、写请求、API 失败、缺失资源、编码 API 路径与 dotfile；缺失入口以 exit 1 启动失败）。
- [x] 调整 Compose 服务、端口、外部数据库配置、共享镜像与健康检查（需求：`IMG-FR-004`、`IMG-FR-005`、`IMG-NFR-002`；验证：config --quiet 仅列出 migrate/server 且无卷；外部空库 clean-room 启动、数据库不可达失败注入、bootstrap 及登录通过）。
- [x] 核对移除代理后的流式传输与认证边界（需求：`IMG-FR-006`、`IMG-NFR-001`；验证：既有 Files 测试 16 项通过，Server 继续直接流式处理并保持既有超限、取消及空闲超时实现；实际 HTTPS/NAS 传输留在阶段 2）。

## 阶段 2：运行验收

- [x] 运行 pnpm format:check、pnpm lint、pnpm typecheck、pnpm build 及相关 Server 测试（需求：`IMG-FR-001` 至 `IMG-FR-007`；验证：lint/typecheck/build 和 17 项测试通过；本次文件 Prettier 检查通过；全仓 format:check 仅因未改动的 `update-resource.dto.ts` 既有格式问题失败）。
- [x] 完成外部空库启动与重启持久化；旧部署数据库迁移与回滚演练由维护者延期至首次生产部署（需求：`IMG-FR-004`、`IMG-FR-005`、`IMG-NFR-002`；验证：本机路径通过，延期项明确记录为未验证）。
- [x] 实际 NAS 的 HTTPS/SMB smoke 和超过 120 秒的大文件传输由维护者延期至首次生产部署（需求：`IMG-FR-006`、`IMG-NFR-003`；验证：实现与自动化回归通过，环境特定路径明确记录为未验证）。
- [x] 使用隔离 canary secret 检查镜像、静态响应、错误响应和日志（需求：`IMG-NFR-001`；验证：真实 env 未进入镜像，运行时 canary 未出现在容器日志或 HTTP 响应；只记录脱敏结论）。

## 阶段 3：完成

- [x] 更新根 README、architecture/overview.md、product/product-definition.md、operations/docker.md、operations/files.md、operations/release.md 和 NAS 手动部署指南（需求：`IMG-NFR-002`、`IMG-NFR-003`；验证：链接、命令与最终代码抽查，区分本机实测和未验证 NAS 范围）。
- [x] 汇总验收证据并更新长期文档；维护者接受当前证据，明确延期实际 NAS 与旧部署迁移/回滚验证，将 Spec 标记为 Completed 并归档（需求：全部；验证：2026-09-17 维护者指示）。

## 验证记录

| 日期       | 环境/命令                                                | 结果                                                                                                          | 证据                         |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 2026-09-17 | `pnpm lint`、`pnpm typecheck`、`pnpm build`、Server test | 通过；17/17 测试通过                                                                                          | 本地命令输出                 |
| 2026-09-17 | `pnpm format:check`                                      | 本次文件通过；全仓因未改动的 `apps/server/src/modules/access-control/dto/update-resource.dto.ts` 既有问题失败 | 本地命令输出及 git status    |
| 2026-09-17 | Docker 28.5.1、Compose v2.40.3、arm64                    | 构建通过；镜像约 278 MB，运行用户 node，包含 Web 入口和 SMB Python，不含实际 env                              | 本地镜像检查；测试镜像已删除 |
| 2026-09-17 | 外部临时 MySQL + 隔离 Compose 项目，端口 18082           | Compose 仅创建 migrate/server 且无卷；外部空库迁移 exit 0、server 健康、管理员初始化和登录通过                | 临时容器、网络及镜像已删除   |
| 2026-09-17 | 隔离 Compose 项目连接不可达外部数据库                    | migrate exit 1，server 保持 created 且从未启动                                                                | 临时容器、网络及镜像已删除   |
| 2026-09-17 | `WEB_STATIC_ROOT=/missing`                               | 容器 exit 1，明确报告入口目录缺失且未输出 secret                                                              | 本地失败路径                 |
| 延期       | 实际威联通 NAS、HTTPS、SMB 与超过 120 秒传输             | 未验证；维护者延期至首次生产部署                                                                              | 不声明已通过                 |
| 延期       | 旧 Compose 数据库迁移、双镜像升级及旧镜像回滚            | 未验证；维护者延期至首次生产部署                                                                              | 不声明已通过                 |
