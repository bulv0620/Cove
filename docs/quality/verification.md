# 工程验证

验证强度由改动风险决定。提交者必须运行与改动相关的最小集合；高风险边界不得只依赖手工点击。

## 基础检查

当前仓库提供：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
```

如果某个命令因仓库已有问题失败，必须记录失败项、确认是否由本次改动引入，并避免把无关问题描述为已通过。

## 变更矩阵

| 改动类型           | 必需验证                                                             |
| ------------------ | -------------------------------------------------------------------- |
| 仅 Markdown 文档   | Markdown/链接检查（如可用）、`git diff --check`、事实与代码抽查      |
| Web 组件/页面      | lint、typecheck、build、关键交互测试、375/768/1440px、键盘和深浅主题 |
| API/业务逻辑       | lint、typecheck、单元/契约/e2e、权限失败路径                         |
| Prisma schema/迁移 | generate、空库迁移、现有库升级、seed 幂等、备份/回滚说明             |
| 认证/授权          | 角色矩阵、直接 API 越权、旧会话失效、审计                            |
| Secret/外部集成    | threat model、secret 泄露扫描、contract test、超时/重试/部分失败     |
| Docker/部署        | clean-room 启动、healthcheck、重启、卷持久化、版本固定、回滚演练     |

## Spec 验证

- 每条功能需求有稳定编号。
- 每条验收条件可以映射到一个或多个自动化/手工验证。
- `tasks.md` 任务关联需求和验证方式。
- Draft 中的开放问题不会被实现代码隐式决定。
- 完成时长期文档与代码现状一致。

## 安全验证

涉及 secret 时，至少使用一个唯一 canary secret 贯穿失败场景，并扫描：

- Server/Web 日志与构建输出。
- API 成功/错误响应。
- 数据库普通字段和审计 metadata。
- operation/step 的安全摘要。
- 生成配置、快照和测试产物。

Canary 只用于隔离测试环境，验证后立即失效。不得把真实 credential 放入测试、截图或 issue。

## 证据要求

高风险 Spec 在 `tasks.md` 保存验证记录，至少包括日期、环境/命令、结果和可定位的 CI/提交/报告。手工验证必须写明前置条件与观察结果，不能只写“测试正常”。
