# 实施任务

> Spec 状态变为 `Approved` 前，不开始业务实现。

## 阶段 0：批准条件

- [x] 所有开放问题已关闭或明确延期。
- [x] 安全、数据迁移和回滚方案已审查。
- [x] 验收条件可执行。

## 阶段 1：实现

- [x] 统一 NestJS dotenv 加载路径（需求：`ENV-FR-001`、`ENV-FR-002`；验证：环境文件加载定向测试）。
- [x] 合并并清理环境变量示例（需求：`ENV-FR-003`、`ENV-FR-004`、`ENV-NFR-001`；验证：`git ls-files '*env*'` 与示例内容检查）。
- [x] 更新使用与架构文档（需求：`ENV-NFR-002`；验证：文档事实与代码抽查、`git diff --check`）。

## 阶段 2：完成

- [x] 运行 lint、typecheck、build 和定向验证并记录结果（需求：`ENV-AC-004`）。
- [x] 更新长期文档并将 Spec 标记为 `Completed`。

## 验证证据

- 2026-09-02：`pnpm lint` 通过。
- 2026-09-02：使用非敏感占位 `DATABASE_URL` 和 `--env-mode=loose` 运行 `pnpm exec turbo typecheck`，通过。loose 模式只用于让 Turborepo 将当前进程变量传给 Prisma generate。
- 2026-09-02：使用相同占位变量运行 `pnpm exec turbo build --env-mode=loose`，Server 与 Web 均构建通过；Vite 报告既有的大 chunk 警告。
- 2026-09-02：定向检查通过，包括 `git diff --check`、根目录示例不存在、唯一 Server 示例位置与变量集合、NestJS 不含根目录 fallback。
- 2026-09-02：本次变更涉及且受 Prettier 支持的文件定向格式检查通过。全库 `pnpm format:check` 仍因本次未修改的 `apps/server/src/modules/access-control/dto/update-resource.dto.ts` 报告既有格式问题。
