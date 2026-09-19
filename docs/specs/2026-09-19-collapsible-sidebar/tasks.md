# 实施任务

## 阶段 0：批准条件

- [x] 所有开放问题已关闭或明确延期。
- [x] 安全、数据迁移和回滚方案已审查。
- [x] 验收条件可执行。

## 阶段 1：实现

- [x] 增加容错的桌面侧栏偏好读写及自动化测试（需求：`NAV-FR-003`；验证：`pnpm --filter @cove/web test`）。
- [x] 实现桌面折叠布局、无障碍标签和双语文案，保持移动抽屉不变（需求：`NAV-FR-001`、`NAV-FR-002`、`NAV-FR-004`、`NAV-NFR-001`；验证：lint、typecheck、build 与响应式手工检查）。

## 阶段 2：完成

- [x] 完成质量验证并记录证据。
- [x] 更新长期文档。
- [x] 将 Spec 标记为 `Completed`。

## 验证证据

- 2026-09-19：`pnpm --filter @cove/web test` 通过，19/19 测试通过；覆盖偏好默认值、合法值与 namespaced 布尔写入。
- 2026-09-19：`pnpm --filter @cove/web lint`、`pnpm --filter @cove/web typecheck`、`pnpm --filter @cove/web build` 通过；Vite 仅报告既有的大 chunk 提示。
- 2026-09-19：本地隔离 mock 登录会话中完成浏览器验证。1440px 浅色/深色下确认展开与 80px 折叠布局、内容偏移、活动态、可访问名称、折叠态导航及刷新恢复；768px 和 375px 确认仍为完整移动抽屉。Playwright CLI 封装因上游请求不存在的 `playwright-core` alpha 版本而无法启动，改用 Codex 本机浏览器控制完成同等检查。
- 2026-09-19：折叠态顶部改为仅显示居中展开按钮；展开动画逐帧采样确认菜单文字在 200ms 内坐标、宽高保持不变且始终为 `nowrap`。维护者确认验收通过。
- 2026-09-19：`pnpm format:check` 与 `git diff --check` 通过。
