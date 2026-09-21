# 实施任务

> Spec 已由维护者通过本次界面调整请求批准并进入实施。

## 阶段 0：批准条件

- [x] 目标状态与非目标明确。
- [x] 无安全、数据迁移或 API 开放问题。
- [x] 验收条件可执行。

## 阶段 1：实现

- [x] 调整状态加载分支，移除图床页头（需求：`IMG-EMPTY-FR-001`；验证：页面结构检查与浏览器验证）。
- [x] 将 SMB 不可用分支改为整页空占位并保留现有操作（需求：`IMG-EMPTY-FR-002`、`IMG-EMPTY-FR-003`、`IMG-EMPTY-NFR-001`；验证：自动化回归与响应式浏览器验证）。
- [x] 确认 SMB 可用界面不变（需求：`IMG-EMPTY-FR-004`；验证：构建与浏览器验证）。

## 阶段 2：完成

- [x] 运行 Web 测试、lint、typecheck、build、格式和差异检查。
- [x] 更新图床长期行为文档与 Spec 索引。
- [x] 汇总验证证据并将 Spec 标记为 `Completed`。

## 验收证据

### 2026-09-19 本地验证

- `pnpm --filter @cove/web test`：22 项通过；新增 2 项覆盖图床加载/不可用分支不含页头或卡片、保留刷新和管理入口，并确认图床与 Files 共用完整高度页面会话布局。
- `pnpm --filter @cove/web lint`、`pnpm --filter @cove/web typecheck`、`pnpm --filter @cove/web build`：通过；构建仅有既有的大 chunk 警告。
- `pnpm format:check`、`git diff --check`：通过。
- 本机隔离 mock 登录会话浏览器验证：375 × 812、768 × 900、1440 × 900 下主内容面板高度均为视口减去 108px 顶栏与页面标签栏，`body.scrollHeight` 等于视口高度；未绑定状态只显示原因、帮助、刷新和用户管理入口，不渲染图床页头。375/768 使用浅色，1440 使用深色，均未发现溢出或主题问题。
