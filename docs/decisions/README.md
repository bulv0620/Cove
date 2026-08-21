# Architecture Decision Records

ADR 记录已经稳定、会约束后续实现且存在明显备选方案的架构决策。尚未批准的方案应留在 Spec 的 `design.md`，不能提前写成 ADR。

## 命名

```text
ADR-0001-short-title.md
ADR-0002-next-decision.md
```

## 必需字段

- Status：Proposed / Accepted / Superseded / Deprecated。
- Date：决策日期。
- Context：约束和需要解决的问题。
- Decision：明确选择。
- Consequences：正面、负面和后续义务。
- Alternatives：被考虑但未选择的方案。
- Related：关联 Spec、代码和替代 ADR。

## 当前待形成的 ADR

Network Spec 批准前至少需要决定：

- Secret Provider、主密钥、备份与轮换。
- Caddy Admin API 的隔离方式。
- FRP client 动态管理方式与版本契约。
- 后台 operation 队列实现。
- 公网入口的 TLS/证书策略。
