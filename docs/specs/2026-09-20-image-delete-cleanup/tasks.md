# 实施任务

> Spec 已由维护者通过本次缺陷修复请求批准并进入实施。

## 阶段 0：批准条件

- [x] 根因、范围与非目标已明确。
- [x] 无数据迁移或安全开放问题。
- [x] 验收条件可执行。

## 阶段 1：实现

- [x] 将图床删除成功响应改为 `204` （需求：`IMG-DELETE-FR-001`）。
- [x] 复用缩略图指纹并在删除/恢复流程精确清理缓存（需求：`IMG-DELETE-FR-002`、`IMG-DELETE-FR-003`、`IMG-DELETE-FR-004`）。
- [x] 增加服务端回归测试（验证：图床单元/契约测试）。

## 阶段 2：完成

- [x] 运行 Server 测试、lint、typecheck、build、格式和差异检查。
- [x] 更新图床长期行为文档与 Spec 索引。
- [x] 汇总验证证据并将 Spec 标记为 `Completed`。

## 验收证据

### 2026-09-20 本地验证

- `pnpm --filter @cove/server test`：36 项通过，1 项需独立 MySQL 的环境型测试跳过。新增用例覆盖 `204` 响应、原图与确定性缩略图删除、原图已不存在的恢复，以及缩略图清理失败保留 `CLEANUP_PENDING`。
- `pnpm --filter @cove/server lint`、`pnpm --filter @cove/server typecheck`、`pnpm --filter @cove/server build`：通过。
- `pnpm format:check`、`git diff --check`：通过。
