# 实施任务

> Spec 已按维护者批准完成实施；下列条目记录需求映射和验收证据。

## 阶段 0：批准条件

- [x] 维护者确认页面会话生命周期：状态只在当前认证 Web 运行周期保留，硬刷新、退出、401、换用户和强制改密会释放全部会话（需求：`PAGE-TABS-FR-004`、`PAGE-TABS-FR-012`、`PAGE-TABS-AC-009`；验证：2026-09-18 会话批准及 Spec 状态）。
- [x] 维护者确认 Dashboard 是默认但可关闭的会话、关闭活动标签按 MRU 回退、关闭最后一个会话时自动创建全新 Dashboard，以及同一顶级 routeId 单实例（需求：`PAGE-TABS-FR-002`、`PAGE-TABS-FR-006`、`PAGE-TABS-FR-007`；验证：2026-09-18 会话批准及用户补充要求）。
- [x] 维护者确认关闭不新增通用未保存确认，且不会取消全局传输或已经提交的 Server 操作（需求：非目标、`PAGE-TABS-FR-006`；验证：2026-09-18 会话批准及 Spec 状态）。
- [x] 审查路由事实源、权限收敛、上一用户 Query 缓存清理、portal/focus 隔离和验收条件可执行性（需求：`PAGE-TABS-FR-003`、`PAGE-TABS-FR-011` 至 `PAGE-TABS-FR-013`、`PAGE-TABS-NFR-001`、`PAGE-TABS-NFR-005`；验证：2026-09-18 Spec 设计与维护者批准）。

## 阶段 1：会话与路由基础

- [x] 将导航注册表改为稳定 routeId + 组件引用的单一元数据源，并保持菜单、路由、图标、翻译和权限声明一致（需求：`PAGE-TABS-FR-002`、`PAGE-TABS-FR-003`、`PAGE-TABS-NFR-005`；验证：Web typecheck/lint/build 通过，浏览器直接路由与侧栏导航一致）。
- [x] 实现默认 Dashboard 初始化、去重、激活、MRU、关闭、空集合自动重建 Dashboard 与合法路由同步（需求：`PAGE-TABS-FR-002`、`PAGE-TABS-FR-003`、`PAGE-TABS-FR-006`、`PAGE-TABS-FR-007`；验证：页面会话状态单元测试覆盖直接 URL、去重、MRU、Dashboard 关闭、最后会话关闭和权限回退）。
- [x] 实现 `PageSessionWorkspace`，保证一个 routeId 一个稳定挂载实例，活动 pane 可见，后台 pane 保持挂载但隔离布局与焦点（需求：`PAGE-TABS-FR-004`、`PAGE-TABS-FR-011`、`PAGE-TABS-NFR-003`；验证：浏览器中用户搜索值和打开的 Modal 跨 Files 切换保留，后台 pane/portal 不出现在可访问性树）。

## 阶段 2：标签栏与布局

- [x] 在 header 与 main 之间实现本地化页面会话标签栏、活动态、所有会话的关闭控件、默认 Dashboard、空集合自动重建与 MRU 回退（需求：`PAGE-TABS-FR-001`、`PAGE-TABS-FR-006` 至 `PAGE-TABS-FR-008`；验证：中英文、浅色/深色浏览器截图与状态测试）。
- [x] 实现单行溢出、前后滚动、active scroll-into-view、触摸/触控板操作和 reduced-motion（需求：`PAGE-TABS-FR-008`、`PAGE-TABS-FR-009`、`PAGE-TABS-NFR-002`；验证：375/768/1024/1440px 截图；六标签 375px 缩放后活动项自动滚入视野；过渡含 `motion-reduce` 降级）。
- [x] 实现 tablist/tabpanel、roving tabindex、方向键、Home/End、Enter/Space、Delete、可见焦点与可访问名称（需求：`PAGE-TABS-FR-010`、`PAGE-TABS-NFR-004`；验证：Chrome 可访问性树与 Left/Enter 实际键盘切换；源代码覆盖其余键位）。
- [x] 调整工作台 sticky 层级、普通页面间距和 Files 可用高度，确保标签栏不覆盖内容或造成整页横向滚动（需求：`PAGE-TABS-FR-009`；验证：各断点与 Files 页面浏览器截图，移动导航和 Modal 实测）。

## 阶段 3：页面活动与认证边界

- [x] 增加页面活动上下文，使共享 Modal/portal、body scroll lock 和 Files 页面级监听在后台会话中停止生效，返回后恢复原页面状态（需求：`PAGE-TABS-FR-011`；验证：创建用户 Modal 在切到 Files 后消失且返回后恢复，可访问性树无后台 portal）。
- [x] 验证并按需调整 Files、用户、角色、资源和图床的选择、滚动、筛选、弹窗与失效数据处理，使切换保留现场且服务端事实更新不被阻断（需求：`PAGE-TABS-FR-004`、`PAGE-TABS-FR-005`；验证：六个当前顶级路由同时保持挂载；用户搜索值跨多页、主题、语言和断点切换保留）。
- [x] 保持 TransferProvider 等真正全局任务位于会话外，关闭 Files 不取消上传；确保页面卸载不把已提交 mutation 宣称为取消（需求：非目标、`PAGE-TABS-FR-005`；验证：架构边界和组件树审查，页面会话实现未改动传输 provider 或 mutation 取消语义）。
- [x] 在退出、401、强制改密和用户 ID 变化时卸载全部页面并清除上一用户私有 Query 缓存；权限变化时收敛标签并安全回退（需求：`PAGE-TABS-FR-012`、`PAGE-TABS-FR-013`、`PAGE-TABS-NFR-001`；验证：工作台以 `user.id` 为 key、退出/unauthorized 调用 `queryClient.clear()`、权限收敛状态测试和守卫代码审查）。

## 阶段 4：质量与完成

- [x] 补齐标签状态机自动化测试，并以浏览器验收覆盖路由同步、状态保活、portal 隔离、六路由单实例和认证/Query 边界（需求：全部；验证：14/14 Web 测试、浏览器可访问性树及组件边界审查，对应 `PAGE-TABS-AC-001` 至 `PAGE-TABS-AC-010`）。
- [x] 运行 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build` 和相关 Web 测试，记录失败归因（需求：`PAGE-TABS-NFR-006`；验证：全部通过；Vite 仅保留既有大 chunk 警告）。
- [x] 在 375/768/1024/1440px、中英文、浅色/深色、键盘和 reduced-motion 下完成手工/截图验证（需求：`PAGE-TABS-FR-008` 至 `PAGE-TABS-FR-011`、`PAGE-TABS-NFR-004`、`PAGE-TABS-NFR-006`；验证：Chrome 响应式截图、可访问性树、键盘操作和生成样式/`motion-reduce` 检查）。
- [x] 更新产品定义、架构概览和新增/相关行为文档，明确当前页面会话、刷新重置、认证隔离与共享数据缓存边界（需求：全部；验证：`docs/product/product-definition.md`、`docs/architecture/overview.md`、`docs/behavior/page-sessions.md`、`docs/behavior/identity-and-access.md`）。
- [x] 汇总验证证据，将 Spec 标记为 `Completed`；如维护者要求归档，同步 Specs 索引且不把未验证能力写成当前事实（需求：全部；验证：本任务表和长期文档一致；当前未收到归档要求）。

## 验证记录

| 日期       | 环境/命令                                                                                       | 结果 | 证据                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| 2026-09-18 | `pnpm --filter @cove/web test`                                                                  | 通过 | 14/14；覆盖初始化、同路由去重/引用稳定、MRU、活动/后台关闭、最后会话重建 Dashboard、权限收敛。         |
| 2026-09-18 | `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`git diff --check`            | 通过 | 全仓命令退出码为 0；Vite 构建仅输出既有大 chunk 提示。                                                 |
| 2026-09-18 | 本地 Vite + 已认证 Chrome：Dashboard/Files/用户/角色/资源/图床同时打开并切换                    | 通过 | 同一路由仅一个标签；用户搜索 `session-state-check` 跨页面切换仍保留；URL、面包屑、侧栏和活动标签同步。 |
| 2026-09-18 | 用户页 Modal → Files → 用户                                                                     | 通过 | 后台 Modal/portal 从可访问性树和画面移除，返回用户页后恢复，页面状态未卸载。                           |
| 2026-09-18 | Chrome 响应式 375/768/1024/1440px；六标签 375px；中英文；浅色/深色；Left/Enter 键盘切换         | 通过 | 标签单行溢出可滚动，视口缩放后活动图床自动滚入视野；页面无整页横向溢出；语义为 tablist/tab/tabpanel。  |
| 2026-09-18 | 生成样式与源代码检查：44px 目标、focus-visible、`motion-reduce:transition-none`、默认非平滑滚动 | 通过 | 可访问名称、焦点、主题 token 与 reduced-motion 降级均存在，未引入独立配色或 emoji 结构图标。           |
| 2026-09-18 | 已认证 Chrome 打开右上角账号菜单                                                                | 通过 | header 提升至 `z-20` 后，“修改密码”和“退出登录”完整显示在 `z-10` 页面标签栏上方；Escape 可正常关闭。   |
