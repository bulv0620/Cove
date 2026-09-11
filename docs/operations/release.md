# 提交、推送与发布

## 提交前

1. 阅读当前 Spec 状态；Draft 不提交业务实现。
2. 检查 `git status`，不得覆盖或混入不相关的用户修改。
3. 按 [`../quality/verification.md`](../quality/verification.md) 执行相应检查。
4. 检查迁移、环境变量、secret、日志和生成文件。
5. 更新 Spec 任务与长期文档。

## Commit

提交应保持单一意图，推荐 Conventional Commits：

```text
docs: establish spec coding workflow
feat(users): add user status filtering
fix(auth): reject expired sessions
```

- 不提交 `.env`、Token、密码、私钥、数据库转储或包含 secret 的日志。
- 文档与其描述的行为应在同一变更中提交。
- 迁移与依赖它的代码应保持可审查的发布顺序。

## Push

- Push 前确认目标分支和远端。
- 默认不强推共享分支；确需改写历史时必须得到维护者明确同意。
- Push 不是发布完成的证据；仍需等待 CI/部署验证。

## 当前发布现状

当前仓库尚未定义自动化 production release、生产 Compose 或版本 tag 流程。增加这些能力必须通过 Spec 或 ADR，不能在本文中假设它们已经存在。

## 包含数据库迁移的发布

1. 备份数据库并验证备份可读。
2. 在与生产相同版本的副本上运行 migration deploy。
3. 先发布兼容新旧数据形态的 Server，再启用新功能。
4. 验证 seed 幂等、关键 API 和旧功能。
5. 记录回滚边界。已执行的数据迁移不能依赖简单代码回滚自动撤销。

## 包含外部基础设施的发布

- 固定镜像和二进制版本，不使用 `latest`。
- 发布前保存上一份已验证配置和版本。
- 先校验、后原子应用，再执行端到端探测。
- 失败时停止继续扩散变更，执行已定义的补偿/回滚并保留 operation 证据。

## 发布完成

- 验收条件全部通过。
- 监控窗口内没有未解释的新错误。
- 回滚路径仍可执行。
- 长期文档已更新，Spec 状态为 `Completed`。
