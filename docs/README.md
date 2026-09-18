# Cove 项目文档

本目录记录 Cove 的长期产品事实、架构边界、领域行为和迭代规格。它面向维护者与编码 Agent，不替代面向使用者的根目录 `README.md`。

## 文档分层

| 层级       | 解决的问题                               | 主要位置                        |
| ---------- | ---------------------------------------- | ------------------------------- |
| 产品事实   | Cove 当前是什么、不是什么                | `product/product-definition.md` |
| 架构事实   | 模块如何协作，状态、接口和部署边界在哪里 | `architecture/`                 |
| 领域规则   | 用户可观察行为和高风险语义               | `behavior/`                     |
| 变更意图   | 某次迭代要改变什么、如何验收             | `specs/`                        |
| 工程质量   | 不同改动必须完成哪些验证                 | `quality/verification.md`       |
| 提交与发布 | 如何提交、推送、迁移和发布               | `operations/release.md`         |
| 稳定决策   | 为什么选择某个长期方案                   | `decisions/`                    |

## 权威性与冲突处理

同一问题出现冲突时，按以下顺序处理：

1. 已批准且仍在实施中的 Spec，决定本次变更的目标行为。
2. `behavior/` 中的领域文档，决定未被本次 Spec 明确改变的长期行为。
3. `decisions/` 中未被废弃的 ADR，决定架构约束及其理由。
4. `architecture/` 和 `product/` 记录当前系统事实。
5. 代码和自动化测试证明实际行为。
6. 用户 README、代码注释和历史记录仅作为辅助信息。

批准的 Spec 与长期文档不一致时，应在实现完成时同步更新长期文档。代码与长期文档不一致时，不得默默选择一方：先确认是代码缺陷还是文档漂移，并在当前 Spec 中记录结论。

## 阅读路径

首次参与项目时按顺序阅读：

1. [`product/product-definition.md`](product/product-definition.md)
2. [`architecture/overview.md`](architecture/overview.md)
3. 与任务有关的 `behavior/` 文档
4. [`specs/README.md`](specs/README.md)
5. 当前任务的 `spec.md`、`design.md` 和 `tasks.md`
6. [`quality/verification.md`](quality/verification.md)

准备提交、推送或发布时，阅读 [`operations/release.md`](operations/release.md)。

需要将本地镜像手动传输到威联通 NAS 时，阅读 [`operations/nas-manual-deployment.md`](operations/nas-manual-deployment.md)。

## Spec Coding 工作流

1. **建立事实**：先阅读长期文档与相关代码，区分当前行为和计划能力。
2. **提出变更**：在 `specs/<date>-<change>/` 中编写 `spec.md`，明确范围、需求和验收条件。
3. **形成设计**：在 `design.md` 中记录边界、状态、接口、安全和失败恢复方案。
4. **批准后实施**：只有 Spec 状态变为 `Approved` 才开始业务实现；按照 `tasks.md` 逐项推进。
5. **持续验证**：每个任务同时交付相应测试或验证证据，不把验证集中留到最后。
6. **沉淀事实**：完成后更新 `product/`、`architecture/` 或 `behavior/`，将 Spec 标记为 `Completed`。

## 维护规则

- 长期文档描述“当前行为”时，必须能在代码、配置或验证结果中找到依据。
- 计划中的能力只能出现在 Draft/Approved/In Progress Spec 或 roadmap，不能写成当前事实。
- 改变用户行为、数据格式、API 契约、安全边界或部署拓扑时，应先更新 Spec，再实现代码。
- 完成变更时，将稳定规则沉淀到 `behavior/` 或 `architecture/`，不要只保留在归档 Spec 中。
- 简单文案、局部样式和无行为变化的小修复不需要创建空洞 Spec；在提交说明中记录即可。
- 文档链接使用仓库相对路径，避免绑定某个远端仓库地址或分支。
