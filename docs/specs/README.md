# Specs

Spec 描述一次有边界的行为变更。它不是脑暴记录，也不是完成后才补写的实现总结。

## 目录约定

```text
specs/
  YYYY-MM-DD-change-name/
    spec.md       目标、范围、需求与验收条件
    design.md     架构、数据、接口、安全和迁移设计
    tasks.md      可验证的实施任务与进度
  archive/        已按维护者要求归档的 Spec，保留实际验收状态
  _template/      新 Spec 模板
```

## 状态

| 状态        | 含义                         | 是否允许实现         |
| ----------- | ---------------------------- | -------------------- |
| Draft       | 正在讨论，范围和设计可能变化 | 否，只允许探索性验证 |
| Approved    | 目标、边界和验收条件已确认   | 是                   |
| In Progress | 已批准且正在实施             | 是                   |
| Blocked     | 存在明确阻塞条件             | 仅处理阻塞项         |
| Completed   | 验收通过，长期文档已同步     | 不再追加新范围       |
| Superseded  | 被另一份 Spec 取代           | 否                   |

状态变更必须修改 `spec.md` 头部元数据。`Approved` 表示产品范围获准；如果设计中仍有安全或数据迁移的开放问题，不得进入实现。

## 编写要求

- 使用 MUST/SHOULD/MAY 或“必须/应该/可以”区分约束强度。
- 每条可验证需求使用稳定编号，例如 `NET-FR-001`。
- 明确非目标，防止实施过程中自然膨胀范围。
- 验收条件描述用户可观察结果或可执行验证，不写“代码优雅”等主观结论。
- `design.md` 解释如何满足需求，但不得悄悄新增产品需求。
- `tasks.md` 中每项任务都应关联需求编号与验证方式。
- 发现新范围时先更新 Spec 并重新批准，不在实现提交中偷带。

## 当前 Specs

| Spec                                                                                     | 状态      | 说明                           |
| ---------------------------------------------------------------------------------------- | --------- | ------------------------------ |
| [`2026-09-02-unify-environment-file`](2026-09-02-unify-environment-file/spec.md)         | Completed | 统一本地 Server 环境变量文件   |
| [`2026-09-19-collapsible-sidebar`](2026-09-19-collapsible-sidebar/spec.md)               | Completed | 增加桌面侧栏折叠与本地偏好记忆 |
| [`2026-09-19-images-development-refresh`](2026-09-19-images-development-refresh/spec.md) | Completed | 修复图床页面开发态刷新 404     |

## 归档 Specs

- [`2026-09-19-page-session-sidebar-location-restore`](archive/2026-09-19-page-session-sidebar-location-restore/spec.md)：Completed，维护者于 2026-09-19 验收通过；修复侧栏重新激活页面会话时丢失 Files `?path=...` 等完整地址的问题。
- [`2026-09-18-page-session-tabs`](archive/2026-09-18-page-session-tabs/spec.md)：Completed，维护者于 2026-09-18 验收通过并要求归档；交付顶部页面会话标签、页面状态保活、关闭释放、认证隔离和响应式/可访问性支持。
- [`2026-09-18-smb-image-hosting`](archive/2026-09-18-smb-image-hosting/spec.md)：Completed，维护者于 2026-09-18 验收当前实现并要求归档；交付 SMB 图床、手动公开链接、绑定失效、内容校验与恢复机制，环境特定 NAS/浏览器验证按记录延期。
- [`2026-09-18-login-brute-force-protection`](archive/2026-09-18-login-brute-force-protection/spec.md)：Completed，维护者于 2026-09-18 验收通过并要求归档；实现 IP + 用户名登录限流、递增冷却、统一 429 响应和安全审计。
- [`2026-09-17-cove-rename`](archive/2026-09-17-cove-rename/spec.md)：Completed，维护者于 2026-09-18 验收通过并要求归档；统一 Cove 品牌并移除改名兼容逻辑。

2026-09-17 按维护者要求，归档文档的品牌、包名与命令统一为 Cove 命名。历史日期与结果保持原记录；规范后的命令不是当时执行文本的逐字副本，也不代表重新运行验证。

- [`2026-09-17-single-application-image`](archive/2026-09-17-single-application-image/spec.md)：Completed，合并 Web 与 Server 为单应用镜像，通过 env 连接外部 MySQL；维护者验收当前实现，实际 NAS 与旧部署现场验证明确延期。
- [`2026-09-11-docker-deployment`](archive/2026-09-11-docker-deployment/spec.md)：维护者确认通过并于 2026-09-11 要求归档。配置已交付，完整容器验收受网络阻塞；保留 `In Progress` 状态及待验证记录。
- [`2026-09-13-smb-files`](archive/2026-09-13-smb-files/spec.md)：维护者确认当前内容验收通过并于 2026-09-14 要求归档。SMB 个人目录、用户绑定与 Files 资源管理器已交付；Docker 完整运行验收按维护者要求延期。
- [`2026-09-15-remove-planned-navigation`](archive/2026-09-15-remove-planned-navigation/spec.md)：Completed，维护者于 2026-09-15 验收通过并要求归档；移除规划中菜单与系统空分组。
