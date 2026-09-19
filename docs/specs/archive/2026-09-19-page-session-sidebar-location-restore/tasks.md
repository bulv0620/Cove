# 实施任务

> 维护者于 2026-09-19 明确要求修复并自行验收；当前实现已验收通过并归档。

## 阶段 0：事实与范围

- [x] 复现并区分顶部标签返回与左侧导航返回行为（需求：`PAGE-LOCATION-FR-001`；验证：已认证 Chrome 中顶部标签保留 `?path=Image+Hosting`，侧栏返回覆盖为 `/files`）。
- [x] 确认直接 URL、页面内链接和浏览器历史不得被缓存重写（需求：`PAGE-LOCATION-FR-002`；验证：设计决策表）。

## 阶段 1：实现

- [x] 为侧栏导航附加 routeId 意图，并仅在 `PUSH` 导航中恢复已有会话完整 location（需求：`PAGE-LOCATION-FR-001` 至 `PAGE-LOCATION-FR-003`；验证：单元测试与浏览器回归）。
- [x] 覆盖新会话、已打开 Files 查询参数、普通导航和无效 state（需求：全部；验证：Web 测试）。

## 阶段 2：完成

- [x] 运行 format、lint、typecheck、build、Web 测试和 diff 检查（需求：`PAGE-LOCATION-NFR-002`）。
- [x] 更新长期行为文档与验证记录，将实现交给维护者验收（需求：全部）。
- [x] 维护者验收后标记 `Completed` 并按要求归档。

## 验证记录

| 日期       | 环境/命令                                                        | 结果 | 证据                                                                                  |
| ---------- | ---------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------- |
| 2026-09-19 | 已认证 Chrome：Files 子目录 → Users → 侧栏 Files（修复前）       | 失败 | 地址由 `/files?path=Image+Hosting` 变为 `/files`，确认侧栏基础路径覆盖已保存 location |
| 2026-09-19 | `pnpm --filter @cove/web test`                                   | 通过 | 17/17；覆盖已有会话完整 location、普通导航、新会话及无效 navigation state             |
| 2026-09-19 | 已认证 Chrome：Files 子目录 → Users → 侧栏 Files（修复后）       | 通过 | 地址保持 `/files?path=Image+Hosting`，面包屑和文件列表仍位于 `Image Hosting`          |
| 2026-09-19 | `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过 | 全仓格式、Lint、类型检查和生产构建均通过；构建仅保留既有的大 chunk 提示               |
| 2026-09-19 | `git diff --check`                                               | 通过 | 无空白错误                                                                            |
| 2026-09-19 | 维护者人工验收                                                   | 通过 | 维护者确认修复符合预期并批准归档                                                      |
