# 实施任务

> Spec 已由维护者通过本次修复请求批准并进入实施。

## 阶段 0：批准条件

- [x] 所有开放问题已关闭。
- [x] 安全、数据迁移和回滚方案已审查；本次无数据迁移。
- [x] 验收条件可执行。

## 阶段 1：实现

- [x] 收窄 Vite 公开图片代理边界（需求：`DEV-ROUTE-FR-001`、`DEV-ROUTE-FR-002`；验证：Web 自动化测试及开发服务器 HTTP smoke）。
- [x] 增加代理路径回归测试（需求：`DEV-ROUTE-NFR-001`；验证：`pnpm --filter @cove/web test`）。

## 阶段 2：完成

- [x] 运行 Web lint、typecheck、build、格式和差异检查。
- [x] 更新图床长期行为文档与 Spec 索引。
- [x] 在本机 Chrome 对 `/images` 执行硬刷新验证。
- [x] 汇总证据并将 Spec 标记为 `Completed`。

## 验收证据

### 2026-09-19 本地开发验证

- `pnpm --filter @cove/web test`：20 项通过；新增用例确认 `/image` 与 `/image/public-id` 命中代理，`/images` 与 `/image-gallery` 不命中。
- `curl -H 'Accept: text/html' http://localhost:5173/images`：返回 `200` 与 Vite `index.html`；`/image/test-public-id` 仍由 NestJS 返回公开图片端点的结构化 404，证明代理保留。
- `pnpm --filter @cove/web lint`、`pnpm --filter @cove/web typecheck`、`pnpm --filter @cove/web build`：通过；构建仅有既有的大 chunk 警告。
- `pnpm format:check`、`git diff --check`：通过。
- 本机 Chrome 在 `http://localhost:5173/images` 硬刷新后显示 Cove 图床页面，并完成同步显示 2 张图片；不再出现 `Cannot GET /images`。
