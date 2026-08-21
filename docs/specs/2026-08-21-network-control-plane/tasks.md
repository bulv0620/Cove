# 统一网络控制面：实施任务

> 当前 Spec 状态：`Draft`。状态变为 `Approved` 前，不开始业务实现。探索性 spike 只能产出结论、测试代码或 ADR，不得成为默认启用的生产路径。

## 完成定义

一项任务只有在以下条件全部满足时才能勾选：

- 关联需求已由实现和自动化测试覆盖。
- 失败路径和权限边界已验证，不仅验证 happy path。
- 没有把 secret、外部完整响应或临时调试配置提交到仓库。
- 相关文档、迁移、国际化文案和操作说明同步更新。
- 验证证据记录在本文件“验证记录”或对应 PR/提交说明中。

## 阶段 0：批准条件

- [ ] `NET-TASK-001` 确认第一版范围、非目标和验收条件。（需求：全部；验证：maintainer 将 Spec 标记为 `Approved`）
- [ ] `NET-TASK-002` 完成 Secret Provider threat model 与恢复/轮换演练设计。（需求：`NET-FR-050`–`055`；产物：ADR）
- [ ] `NET-TASK-003` 完成 frpc 管理接口版本 spike，验证 create/update/delete、持久化、重启恢复和认证；决定 API 或配置 reload adapter。（需求：`NET-FR-033`；验证：受控集成测试）
- [ ] `NET-TASK-004` 确认 Caddy Admin API 使用私有 TCP 或 Unix socket，并完成 Compose 权限验证。（需求：`NET-FR-024`、`054`；产物：ADR）
- [ ] `NET-TASK-005` 确认 Cloudflare proxied 模式的源站证书策略和证书恢复流程。（需求：`NET-FR-021`；产物：ADR）
- [ ] `NET-TASK-006` 确认远端 `frps` 支持矩阵与 sudo 前提。（需求：`NET-FR-014`–`016`；产物：支持矩阵）
- [ ] `NET-TASK-007` 确认数据库租约 operation queue 方案可满足单实例和重启恢复。（需求：`NET-FR-040`–`044`；验证：并发 spike）

## 阶段 1：领域与持久化基础

- [ ] `NET-TASK-101` 增加 Network Prisma enums/models、索引和非破坏性迁移。（需求：`NET-FR-020`、`030`、`040`；验证：空库迁移 + 现有库升级 + rollback runbook）
- [ ] `NET-TASK-102` 在 seed 中创建 Network 页面和动作权限，验证 administrator/viewer 的预期授权。（需求：权限章节；验证：seed 幂等测试）
- [ ] `NET-TASK-103` 实现 Desired/Applied/Observed 类型、revision 和状态机不变量。（需求：`NET-FR-002`、`003`、`034`；验证：领域单元测试）
- [ ] `NET-TASK-104` 实现 operation/step 持久化、租约、幂等键和进程恢复。（需求：`NET-FR-040`–`044`；验证：并发、超时、崩溃恢复测试）
- [ ] `NET-TASK-105` 实现审计写入和 safe summary schema。（需求：`NET-FR-041`、`045`、`051`；验证：敏感值注入测试）

## 阶段 2：Secret Provider

- [ ] `NET-TASK-201` 实现经 ADR 批准的 AEAD secret storage 与 key version。（需求：`NET-FR-050`；验证：加解密、篡改检测、不同 nonce）
- [ ] `NET-TASK-202` 实现 secret create/replace/delete，不提供 read-back API。（需求：`NET-FR-010`、`050`；验证：API contract test）
- [ ] `NET-TASK-203` 实现日志/API/审计脱敏 guard 和回归扫描。（需求：`NET-FR-051`；验证：canary secret 全链路扫描）
- [ ] `NET-TASK-204` 编写主密钥备份、恢复和轮换 runbook，并在临时环境演练。（需求：`NET-NFR-002`；验证：恢复记录）

## 阶段 3：Mock runtime 与 API

- [ ] `NET-TASK-301` 定义 Provider、DNS、Tunnel、ReverseProxy、RemoteHost 和 Secret adapter 接口。（需求：全部集成需求；验证：TypeScript contract tests）
- [ ] `NET-TASK-302` 实现 deterministic fake adapters 和五个标准场景。（需求：`NET-AC-008`、`NET-NFR-007`；验证：scenario tests）
- [ ] `NET-TASK-303` 实现 Network overview/providers/endpoints/mappings/operations API 与 DTO 验证。（需求：`NET-FR-001`–`004`、`020`–`044`；验证：controller/e2e tests）
- [ ] `NET-TASK-304` 实现 revision 冲突、hostname/端口冲突、target allow-list 和 SSRF 防护。（需求：`NET-FR-022`、`023`、`032`；验证：边界/恶意输入测试）
- [ ] `NET-TASK-305` 实现 Network 权限守卫与直接 API 越权测试。（需求：权限章节、`NET-AC-009`；验证：角色矩阵 e2e）

## 阶段 4：Web 控制面

- [ ] `NET-TASK-401` 增加权限驱动 Network 导航和稳定子路由。（需求：`NET-FR-004`；验证：路由/权限测试）
- [ ] `NET-TASK-402` 实现访问链路、Provider 状态卡和 freshness 展示。（需求：`NET-FR-001`–`003`；验证：组件测试 + stale 场景）
- [ ] `NET-TASK-403` 实现公网入口列表、创建/编辑流程、操作状态和冲突错误。（需求：`NET-FR-020`–`029`；验证：Mock E2E）
- [ ] `NET-TASK-404` 实现端口映射管理和端口冲突提示。（需求：`NET-FR-030`–`034`；验证：Mock E2E）
- [ ] `NET-TASK-405` 实现 Provider 设置向导、secret replace 交互、SSH fingerprint 确认和部署确认。（需求：`NET-FR-010`–`017`、`052`；验证：Mock E2E）
- [ ] `NET-TASK-406` 实现 operation 列表/详情/重试和可恢复错误行动建议。（需求：`NET-FR-040`–`044`；验证：失败/部分成功 E2E）
- [ ] `NET-TASK-407` 完成中英文、键盘、焦点、非颜色状态、375/768/1440px 和深浅主题检查。（需求：`NET-NFR-005`；验证：a11y + visual checklist）

## 阶段 5：Caddy 数据面

- [ ] `NET-TASK-501` 提供固定版本 Caddy sibling container、私有 Admin API、数据卷和 healthcheck。（需求：`NET-FR-017`、`054`；验证：Compose integration）
- [ ] `NET-TASK-502` 实现确定性完整配置 render/adapt/validate/load 和串行锁。（需求：`NET-FR-024`；验证：golden files + concurrent update）
- [ ] `NET-TASK-503` 实现无效配置保持旧 route、snapshot 与回滚。（需求：`NET-NFR-002`、`NET-AC-004`；验证：故障注入）
- [ ] `NET-TASK-504` 实现 upstream 与 HTTPS observation。（需求：`NET-FR-002`、`NET-AC-003`；验证：健康/失败/stale）

## 阶段 6：FRP 数据面与远端部署

- [ ] `NET-TASK-601` 提供固定版本 frpc sibling container、私有管理接口、store、healthcheck 和 restart policy。（需求：`NET-FR-017`、`033`；验证：重启恢复）
- [ ] `NET-TASK-602` 实现共享 443 tunnel 与普通 TCP/UDP mapping adapter。（需求：`NET-FR-029`–`034`；验证：本地 frps integration）
- [ ] `NET-TASK-603` 实现 SSH host key trust-on-first-use 与 rotation flow。（需求：`NET-FR-052`；验证：fingerprint change test）
- [ ] `NET-TASK-604` 实现远端 preflight 与受控、版本化安装脚本。（需求：`NET-FR-013`–`015`、`053`；验证：支持矩阵 VM）
- [ ] `NET-TASK-605` 实现 frps deploy/upgrade/restart/rollback 和 checksum 验证。（需求：`NET-FR-015`、`016`、`NET-AC-001`；验证：故障注入 VM）
- [ ] `NET-TASK-606` 实现 frpc/frps runtime observation 与 stale 规则。（需求：`NET-FR-002`、`003`；验证：断网/恢复测试）

## 阶段 7：Cloudflare 与完整协调

- [ ] `NET-TASK-701` 实现 API Token 验证、Zone 筛选和最小权限提示。（需求：`NET-FR-010`–`012`、`055`；验证：provider contract tests）
- [ ] `NET-TASK-702` 实现 owned DNS record list/upsert/delete 与外部记录冲突保护。（需求：`NET-FR-025`–`028`；验证：隔离测试 Zone）
- [ ] `NET-TASK-703` 实现创建/更新/禁用/删除 saga 顺序和补偿。（需求：`NET-FR-024`–`029`、`040`–`044`；验证：逐步骤故障注入）
- [ ] `NET-TASK-704` 实现 periodic observation、full reconcile 和 drift report。（需求：`NET-FR-002`、`003`、`044`；验证：人工 drift 测试）
- [ ] `NET-TASK-705` 完成真实 `DNS → FRP → Caddy → service` 验收。（需求：`NET-AC-003`、`006`；验证：测试域名）

## 阶段 8：部署、发布与完成

- [ ] `NET-TASK-801` 提供生产 Compose、Docker secrets、固定版本、healthcheck 和备份说明。（需求：`NET-NFR-001`、`006`；验证：全新 NAS-like VM）
- [ ] `NET-TASK-802` 提供 `network-dev` profile，确保不占用 80/443、不访问真实 provider。（需求：`NET-AC-008`；验证：开发机 clean-room）
- [ ] `NET-TASK-803` 执行整个栈重启/断电恢复验收。（需求：`NET-AC-007`；验证：Compose restart + host reboot）
- [ ] `NET-TASK-804` 执行 secret/log/API 扫描和权限矩阵。（需求：`NET-AC-009`、`010`；验证：安全报告）
- [ ] `NET-TASK-805` 更新长期 `product/architecture/behavior` 文档，移除“不包含 Network”的过时事实。（验证：文档审查）
- [ ] `NET-TASK-806` 关闭功能开关、完成发布和回滚演练，将 Spec 标记为 `Completed`。（验证：release checklist）

## 验证记录

| 日期 | 范围 | 环境/命令 | 结果     | 证据 |
| ---- | ---- | --------- | -------- | ---- |
| —    | —    | —         | 尚未开始 | —    |
