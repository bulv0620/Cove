# 实施任务

> Spec 状态：`Completed`（维护者 2026-09-21 验收通过）。实现与修复过程、机器证据与验收记录见下；本表保留为交付记录。

## 阶段 0：批准条件

- [x] 用同一组 Markdown fixture 分别验证 MDXEditor 与 Milkdown Crepe 的导入/导出、局部编辑、撤销/重做、中文输入法、图片粘贴、深浅主题和移动端行为，关闭 `NOTE-OQ-001`、`NOTE-OQ-003`（需求：`NOTE-FR-005`、`NOTE-FR-006`、`NOTE-NFR-002`；验证：可复现原型与往返差异报告）。
  - 结论（2026-09-21）：编辑器选定 MDXEditor（候选原型与依赖保留在 `prototype/editor-lab/`），方言与规范化以 `test/markdown-roundtrip.test.cjs` 的固定语料往返固定（一次规范化后幂等、原始 HTML 惰性保留、JSX/未知语法导入中止）；维护者真实验收通过本轮交付，关闭 `NOTE-OQ-001`、`NOTE-OQ-003`。
- [x] 在目标 QNAP 上验证来源身份检查、临时文件 flush、既有目标原子替换、共享/锁定行为及各中断点结果，关闭 `NOTE-OQ-002`（需求：`NOTE-FR-007`、`NOTE-FR-008`、`NOTE-NFR-003`、`NOTE-NFR-004`；验证：live SMB 测试记录）。
  - 结论（2026-09-21）：维护者在真实 NAS 环境完成验收（含保存、冲突提示、重命名/删除等日常路径），判定通过并关闭 `NOTE-OQ-002`；机器侧的身份校验与中断恢复证据见阶段 1 与阶段 4 条目。
- [x] ~~确认自动保存时间参数并用预期写作会话计算 SMB 提交上限~~（2026-09-21 作废：改为显式保存，见阶段 5；`NOTE-OQ-004` 已关闭为不适用）。
- [x] 确认 Notes 与图床权限矩阵，关闭 `NOTE-OQ-005`（需求：`NOTE-FR-001`、`NOTE-FR-012`、`NOTE-NFR-008`；验证：角色矩阵）。
  - 结论（2026-09-21）：权限粒度按 `workspace.notes.{page,create,update,rename,delete}` 落地（Server 逐动作鉴权，`notes.test.cjs` 覆盖授权矩阵），图片粘贴沿用图床既有 `infra.images.*`；权限矩阵本身随本轮验收确认。
  - 注意：这些资源与权限行由 `prisma/seed-rbac.ts` 写入数据库，**必须在部署库上执行 `pnpm db:seed` 才会出现**。超级管理员绕过权限表，因此即使没执行 seed，Notes 页面也能正常使用；维护者 2026-09-21 在资源管理页看不到 Notes 即由此产生，已加为下方阶段 4 的待办。
- [x] 审查第三方编辑器许可证、固定版本、bundle 影响和安全公告（需求：`NOTE-NFR-002`）。
  - 结论（2026-09-21）：MDXEditor 为 MIT、版本锁定 4.2.5（`docs/behavior/notes.md`）；bundle 影响经实测（启用 CodeMirror 代码块后主包 2,042 → 2,483 kB，gzip 547 → 690 kB）并由维护者明确接受（见阶段 5 条目）。
- [x] 所有开放问题已关闭，安全、数据恢复、回滚和验收方案已审查。（2026-09-21：`NOTE-OQ-001/002/003/005` 关闭、`NOTE-OQ-004` 作废，随验收通过。）
- [x] 维护者将 Spec 状态明确改为 `Approved` 或 `In Progress`。（2026-09-21 维护者确认批准，状态已置为 `Approved`，阶段 1 起开始实施。）

## 阶段 1：服务端存储边界

- [x] 增加 Notes 配置、固定根目录策略、路径/名称/扩展名/UTF-8/大小校验和安全错误码（需求：`NOTE-FR-002`、`NOTE-FR-003`、`NOTE-FR-004`、`NOTE-NFR-001`、`NOTE-NFR-003`；验证：策略单元测试与越界输入表）。
  - 证据：`apps/server/src/modules/notes/notes-config.ts`、`notes-policy.ts`；`apps/server/test/notes.test.cjs` 覆盖固定根、保留名 `.cove-note-`、扩展名、控制字符/孤立代理项/超限正文、严格 UTF-8/BOM 与配置下界（`NOTES_*` 非法值全部抛错）。
- [x] 扩展 SMB worker，实现受限 Markdown 读取和经 QNAP 验证的条件原子替换，保持背压、超时和脱敏错误（需求：`NOTE-FR-007`、`NOTE-FR-008`、`NOTE-NFR-003`；验证：worker 单元测试、模拟 adapter 契约测试、live SMB 测试）。
  - 证据：`apps/server/smb/worker.py` 新增 `write_note`（share=0x1 钉住目标、提交门前/后双重 stat 复核、`FileRenameInformation` 原子替换、最终身份校验）与 `stat_info`（FileAllInformation）；`test/worker-prefixes.test.py` 3 项通过（`.cove-note-` 保留前缀、外源临时路径拒绝）；模拟 adapter 契约测试见 `notes.test.cjs`。live SMB 记录归入阶段 4 验收。
- [x] 增加 `NoteWriteOperation` schema、迁移和保存/恢复状态机（需求：`NOTE-FR-008`、`NOTE-NFR-004`；验证：空库迁移、现有库升级、提交前/提交中断故障注入与恢复测试）。
  - 证据：`prisma/schema.prisma` 新模型 + `prisma/migrations/20260921000000_smb_markdown_notes/`；`notes.test.cjs` 故障注入覆盖提交前冲突（CONFLICT）、提交后中断按 stat 复原（SUCCEEDED/INTERRUPTED/CONFLICT）、租约过期 PREPARING 清理后 FAILED、绑定变更 INTERRUPTED、按 objectId 清理临时文件与保留期删除。空库迁移与现有库升级需连接数据库执行，归入阶段 4 验收。
- [x] 实现目录、正文、新建、重命名、删除、保存和操作状态 API，并添加 JWT、Notes 权限和用户/绑定隔离（需求：`NOTE-FR-001` 至 `NOTE-FR-009`、`NOTE-FR-015`、`NOTE-FR-016`；验证：controller/service 契约、直接 API 越权、外部修改冲突和 NAS 错误测试）。
  - 证据：`apps/server/src/modules/notes/notes.controller.ts`（`@RequirePermissions('workspace.notes.page')` + 每路由动作权限，正文响应 `Cache-Control: no-store`）与 `notes.service.ts`；`notes.test.cjs` 覆盖授权矩阵（缺页权限/缺动作权限/强制改密/未知用户/超级管理员）、过期 revision→`NOTE_CHANGED`（worker 钉住校验拒绝，零写入）、跨路径 revision、篡改签名、requestId 幂等重放、`saved:false` 去重、新建同名 `NAME_CONFLICT`。
- [x] 增加 Notes RBAC resource/permissions seed，验证 administrator 继承与自定义角色显式授权（需求：`NOTE-FR-001`；验证：seed 幂等与权限矩阵）。
  - 证据：`prisma/seed-rbac.ts` 新增 `workspace.notes` 资源与 `page/create/update/rename/delete` 权限（固定 UUID、upsert 幂等、administrator 角色继承全量权限、seed 推进 authVersion）；服务层权限矩阵由 `notes.test.cjs` 覆盖。seed 在真实库上的幂等运行归入阶段 4 验收。
- [x] 增加脱敏审计、操作清理和恢复可观测性（需求：`NOTE-NFR-004`、`NOTE-NFR-005`、`NOTE-NFR-009`；验证：canary 正文/secret 日志与响应扫描）。
  - 证据：审计仅含用户、动作、结果码与路径摘要（sha256 前 32 hex）；`notes.test.cjs` canary 扫描确认正文与路径不出现在审计行；临时文件仅按注册路径+objectId 清理（`cleanup` 动作），恢复轮询 120s、租约/保留期可配。

## 阶段 2：Web 所见即所得编辑

- [x] 增加 Workspace 下的 Notes 导航、权限路由、共享类型、API client 和中英文消息（需求：`NOTE-FR-001`、`NOTE-FR-003`；验证：导航/路由/权限测试）。
  - 证据：`navigation.tsx` 新增 workspace 分组与 `notes` 项（`pagePermission: 'workspace.notes.page'`，路由由现有 `PermissionRoute` 过滤）；`features/notes/api.ts` 覆盖 status/entries/content/create/folders/save/rename/delete/operations 全部端点；`features/notes/messages.ts` 中英文消息并入 `i18n/index.ts`；`resources-page.tsx`、`permission-picker.tsx` 同步 workspace 模块；路由/权限过滤由 `page-session-state.test.cjs` 等既有测试回归覆盖。
- [x] 实现 Notes 响应式目录与笔记页面，并集成页面会话位置恢复（需求：`NOTE-FR-004`、`NOTE-FR-015`、`NOTE-NFR-006`；验证：页面会话回归与 375/768/1440px 手工检查）。
  - 证据：`pages/notes/notes-page.tsx`（目录/编辑器双栏，手机单栏切换；`?dir=`/`?note=` 查询参数驱动）；`page-session-workspace.tsx` 将 notes 加入全高布局与 `removeQueriesForRoutes` 清理；`images-empty-state.test.cjs` 断言更新后 37 项 web 测试全部通过。375/768/1440px 手工检查归入阶段 4（`NOTE-AC-009`）。
- [x] 通过 `MarkdownEditor` adapter 集成批准的所见即所得编辑器和限定方言（需求：`NOTE-FR-005`、`NOTE-FR-006`、`NOTE-NFR-002`；验证：固定 fixture 往返、中文输入法、键盘和主题测试）。
  - 证据：`features/notes/markdown-editor.tsx` 集成 MDXEditor 4.2.5（限定方言插件集、去 CodeMirror 的纯文本代码块编辑器、工具栏仅暴露方言内格式）；`test/markdown-roundtrip.test.cjs` 用真实导入/导出管线验证中英文固定语料往返稳定（一次规范化后幂等）、原始 HTML 惰性保留且原样导出、JSX/未知语法导入中止且不产生部分文档（`NOTE-AC-003`），onError 映射到只读源码视图避免静默覆盖。中文输入法、键盘、深浅主题手工测试归入阶段 4。
- [x] 实现保存队列、内容 hash 去重、状态提示、冲突处理和 IndexedDB 恢复草稿（需求：`NOTE-FR-007`、`NOTE-FR-009`、`NOTE-FR-010`、`NOTE-FR-011`；验证：假时钟、乱序请求、刷新、登出、401、用户变化和 NAS 离线测试）。
  - 证据：`features/notes/save-queue.ts`（draft 500ms/commit 2500ms/30s 硬上限、防抖合并、串行提交、`saved:false` 去重、`NOTE_CHANGED` 冻结为 conflict、其余错误可重试）；`test/notes-save-queue.test.cjs` 12 项假时钟测试覆盖合并、上限、flush 串行、乱序后新文本、回退到已存文本不写、冲突冻结、瞬时失败重试与 dispose；`features/notes/drafts.ts` IndexedDB 草稿按 userId/bindingVersion/path 隔离，登出与 401（`cove:unauthorized`）清空全部草稿、换号 `pruneDraftsForUser`，页面卸载/pagehide 兜底持久化；冲突面板提供重载/另存副本/继续编辑三条出路。刷新、NAS 离线端到端场景归入阶段 4 验收。
- [x] 实现新建文件/目录、同目录重命名、明确删除确认与失败恢复 UI（需求：`NOTE-FR-004`、`NOTE-FR-016`；验证：冲突、非法名称、非空目录和部分失败交互测试）。
  - 证据：`notes-page.tsx` 新建笔记（自动补 `.md`、客户端名称预检）、新建文件夹、同目录重命名（打开中的笔记跟随跳转）与删除确认对话框（明示不可撤销与回收站取决于 NAS），服务端 `NAME_CONFLICT`/`INVALID_PATH` 等错误码映射到中英文提示。冲突、非法名称、非空目录交互测试归入阶段 4 验收。

## 阶段 3：图床集成

- [x] 将编辑器粘贴/拖放图片连接到现有图床 create/upload API，对 Notes 上传显式传递 `publish: true`（需求：`NOTE-FR-012`、`NOTE-NFR-008`；验证：请求契约、权限失败和公开 grant 测试）。
  - 证据：`features/notes/image-uploads.ts` 复用 `imagesApi.createUpload` + `uploadImage`，`publish` 恒为 `true`；未确认公开 grant（state≠PUBLIC 或 publicUrl 非 `/image/` 前缀）时抛错、不产出任何地址；`test/notes-image-upload.test.cjs` 断言请求契约（name/size/requestId/publish）、权限与 grant 失败路径（FILES_FORBIDDEN、SMB_DISK_FULL 透传）。
- [x] 实现图片占位、进度、取消、失败重试和成功后标准 Markdown 地址插入（需求：`NOTE-FR-012`、`NOTE-FR-013`；验证：多图、失败、取消、撤销和保存竞态测试）。
  - 证据：`markdown-editor.tsx` 在容器层拦截粘贴/拖放的图片文件（不注册 imageUploadHandler，编辑器自身永不插入未确认地址）；`notes-page.tsx` 上传面板逐图显示文件名、进度百分比、取消（AbortController + `cancelUpload`）、失败原因与重试，成功后仅在光标处插入 `![alt](/image/{publicId})`；不支持的图片类型显示提示。多图并发、保存竞态的端到端演练归入阶段 4。
- [x] 验证移除引用不删除图床资产，图床撤销/删除和缓存行为未被改变（需求：`NOTE-FR-014`、`NOTE-NFR-008`；验证：Images 回归测试与手工公开链接检查）。
  - 证据：Notes 代码路径仅调用 createUpload/uploadImage/cancelUpload，从不调用 `imagesApi.remove`/`visibility`（可由 `grep -rn "imagesApi" apps/web/src/features/notes` 验证）；`apps/server/src/modules/images/` 本 spec 零改动，Images 页面与服务器测试保持全绿。手工公开链接检查归入阶段 4。

## 阶段 4：综合验证与完成

- [x] 覆盖无绑定、失效绑定、NAS 离线、权限收缩、外部修改/替换/移动/删除、临时文件恢复和绑定变更场景（验收：`NOTE-AC-001` 至 `NOTE-AC-008`）。
  - 人工验收（2026-09-21）：维护者在真实环境完成上述场景的端到端演练并通过；机器证据见本条目的部分机器证据与阶段 1 条目。
  - 部分机器证据：服务端冲突（过期/跨路径/篡改 revision 零写入）、重启恢复对账、临时文件按 objectId 清理与绑定变更已由 `apps/server/test/notes.test.cjs` 覆盖；真实 Python worker 控制流由复审后新增的 `apps/server/test/worker-notes.test.py` 在内存 SMB 服务器上执行（含替换交换、竞态与身份校验）；无绑定/失效绑定/NAS 离线/权限收缩在 Web UI 的端到端表现已随 2026-09-21 的真实环境验收通过。
- [x] 验证目录列表不读取全部正文、后台页面不轮询 SMB、连续输入提交次数受限且相同内容不写入（需求：`NOTE-NFR-007`；验收：`NOTE-AC-004`）。
  - 证据：目录 API 仅枚举元数据、列表路径不读取正文（`notes.service.ts`，`notes.test.cjs` 覆盖）；`apps/web/src/app/providers.tsx` 全局 `refetchOnWindowFocus: false` 且代码库无 `refetchInterval`；`test/notes-save-queue.test.cjs` 假时钟断言 2.5s 防抖合并提交、30s 硬上限与相同内容不重写。
- [x] 完成键盘、可访问名称、中文输入法、移动端、深浅主题与页面会话回归（验收：`NOTE-AC-009`）。
  - 人工验收（2026-09-21）：维护者在真实浏览器完成键盘/中文输入/移动端与深浅主题检查并通过；期间发现的问题（代码块高亮缺失、深色下代码块与下拉/行号残留白底、粘贴代码换行与不可见占位字符、保存后重命名误报冲突、上传卡片位置）均已修复并记录在阶段 5。
  - 部分机器证据：页面会话挂载/恢复/清理与全高布局由既有 web 测试（含更新后的 `images-empty-state.test.cjs`）回归；编辑器可访问名称（`section aria-label`）与错误码即文案映射在源码与测试中固定。键盘、中文输入法、375/768/1440px、深浅主题需人工检查。
- [x] 运行 `pnpm --filter @cove/server test`、`pnpm --filter @cove/web test`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm format:check` 和 `git diff --check`（验收：`NOTE-AC-010`）。
  - 证据（2026-09-21）：server 60 项（59 通过、1 项既有 MySQL 集成用例按既有约定跳过、0 失败）；web 42 项全部通过；`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm format:check`、`git diff --check` 全部通过。
- [x] 更新 `product/`、`architecture/`、`behavior/`、运行配置和维护/恢复说明，将稳定 Notes 行为从 Spec 沉淀到长期文档。
  - 证据：新增 `docs/behavior/notes.md`（权限与目录、页面行为、方言与导入失败回退、保存/冲突/恢复草稿、图片粘贴、审计与隐私）；`docs/architecture/overview.md` 模块边界补 NotesModule；`docs/operations/files.md` 新增 Notes 配置与恢复一节（`NOTES_*` 限额、`NOTES_REVISION_SECRET`、操作保留期与回滚注意）；`docs/product/product-definition.md` 将笔记移入已实现能力并移出“当前不包含”；`docs/product/roadmap.md` 与 `README.md` 状态行同步。
- [x] 记录本地与目标 QNAP 验收证据；全部验收完成后将 Spec 标记为 `Completed`。
  - 证据（2026-09-21）：维护者在真实 NAS + 浏览器环境完成验收并判定通过（`NOTE-AC-001` 至 `NOTE-AC-009`），Spec 状态置为 `Completed`；机器证据见阶段 1–5 各条目与下方「验收证据」。`docs/behavior/notes.md`、`docs/architecture/overview.md`、`docs/product/roadmap.md`、`docs/operations/files.md` 已同步最终行为与已知性能后续项。

## 阶段 5：交互修订（2026-09-21）

维护者在 Chrome 实测后判定：前端页面套在 Full-height 路由里仍带标题与描述、外层再加一圈 padding、两栏各自是卡片；目录是「一次列一层 + `..` 返回」的导航式列表；保存是自动保存（500ms 草稿 / 2.5s 防抖 / 30s 上限），与「写了才存」的预期不符。据此修订需求并实现：

- [x] 页面布局对齐 Files：移除标题、描述与卡片外壳，改为全高「左目录树 + 右编辑器」分栏（需求：`NOTE-FR-004`；验证：源码与构建）。
  - 证据：`pages/notes/notes-page.tsx` 根容器改为 `flex h-full min-h-0 min-w-0 flex-col`，主体为 `relative flex min-h-0 flex-1 overflow-hidden bg-card` + `w-[280px] border-r` 的树面板，删除 `mx-auto max-w-[1440px] px-4 py-6`、`eyebrow`/`title`/`description` 文案与 `rounded-xl border` 卡片；`messages.ts` 删除 `eyebrow`、`description`。
- [x] 目录改为可逐层展开的懒加载树（需求：`NOTE-FR-004`、`NOTE-NFR-007`；验证：源码断言 + 构建）。
  - 证据：新增 `NoteTreeNode`（目录行 chevron 展开/收起、选中目录即新建目标、悬停显示重命名/删除；子层 `useInfiniteQuery` 仅在 `expanded` 时请求同一 `GET /api/notes/entries?path=` 接口，含分页「加载更多」）；`?dir=` 参数移除，URL 只保留 `?note=`，打开深层笔记自动展开其路径；工具条新增目标目录指示与刷新。
- [x] 保存改为显式动作，未保存时切换笔记先询问（需求：`NOTE-FR-009`、`NOTE-FR-010`、`NOTE-FR-011`、`NOTE-AC-004`；验证：假时钟单测 + 源码断言）。
  - 证据：`features/notes/save-queue.ts` 新增 `autoSave?: boolean`（默认 `true` 保持既有 15 项假时钟用例不变）；页面以 `autoSave: false` 运行，`edit()`/`restoreDraft()` 不再安排草稿与提交定时器，编辑器工具条提供保存按钮与 `Ctrl/Cmd + S`，失败后同一按钮重试；未保存时点击/返回其他笔记弹出「保存并切换 / 不保存直接切换 / 继续编辑」，保存失败留在弹窗并显示错误码；恢复草稿只在卸载、`pagehide`、页面隐藏时兜底写入，显式放弃会删除对应草稿；重命名/删除当前笔记前先提交，失败则中止。
  - 证据（测试）：`test/notes-save-queue.test.cjs` 新增 5 项手动模式用例（不自动提交、保存一次即提交、失败保持 dirty 且不后台重试、保存期间的新编辑保持待保存、恢复草稿保持待保存）；新增 `test/notes-unsaved-guard.test.cjs` 4 项源码断言（手动模式与保存按钮、切换询问三选项、放弃后删除草稿且卸载不回写、树懒加载与 `?dir=` 移除）。
- [x] 同步修订 Spec 与长期文档（需求：全部；验证：文档审阅）。
  - 证据：`spec.md` 更新用户场景、`NOTE-FR-004/009/010/011`、`NOTE-AC-004`，将 `NOTE-OQ-004`（自动保存参数）标记作废并追加变更记录；`design.md` 的「自动保存与浏览器草稿」改为「手动保存与浏览器草稿」，同步机械硬盘策略、页面会话与交互状态、组件边界与备选方案；`docs/behavior/notes.md` 更新页面行为与保存章节。

## 验收证据

- 阶段 1（2026-09-21）：`pnpm --filter @cove/server test` 60 项（59 通过、1 项既有 MySQL 集成用例按既有约定跳过、0 失败）；`python3 apps/server/test/worker-prefixes.test.py` 3 项通过；`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm format:check`、`git diff --check` 全部通过。待办：目标 QNAP live SMB 记录、真实库迁移与 seed 幂等运行（归入阶段 4）。
- 阶段 2（2026-09-21）：`pnpm --filter @cove/web test` 37 项全部通过（含新增 `notes-save-queue.test.cjs` 12 项假时钟用例与 `markdown-roundtrip.test.cjs` 3 项真实管线往返用例）；`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm format:check`、`git diff --check` 全部通过。待办：中文输入法/键盘/深浅主题/375-768-1440px 手工检查、端到端刷新与 NAS 离线演练（归入阶段 4）。
- 阶段 3（2026-09-21）：`pnpm --filter @cove/web test` 42 项全部通过（新增 `notes-image-upload.test.cjs` 5 项请求契约用例）；`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm format:check`、`git diff --check` 全部通过。待办：多图/竞态端到端演练与公开链接手工检查（归入阶段 4）。
- 阶段 4（2026-09-21）：完整命令组合全部通过——`pnpm --filter @cove/server test` 60 项（59 通过、1 项既有 MySQL 集成用例按既有约定跳过）、`pnpm --filter @cove/web test` 42 项、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm format:check`、`git diff --check`。长期文档已沉淀（新增 `docs/behavior/notes.md`，更新 architecture/product/operations）。待办：`NOTE-AC-001..003`、`NOTE-AC-005..009` 的人工端到端与交互检查（含中文输入法、键盘、375/768/1440px、深浅主题）、真实库迁移与 seed 幂等运行、目标 QNAP live SMB 记录。
- 复审修复（2026-09-21，用户 Chrome 实测 + 代码复审发现 6 项问题）：①P0——`write_note` 提交后复核误给无参 `unchanged` 传 `target`，已有笔记保存必然抛 TypeError，保存失败；②P1——目录列表返回含 `Markdown Notes/` 根前缀的路径，前端二次请求拼接成 `Markdown Notes/Markdown Notes/...`，打开/重命名/删除指向错误路径；③P1——替换发生在关闭钉住句柄之后，close 与改名之间存在 TOCTOU 竞态，外部修改可能被静默覆盖，违反 design.md 的“stat 后直接覆盖”禁令；④P1——重命名/删除未校验 SMB 对象身份，列表加载后被外部替换的文件可能被误改；⑤P2——弹窗按 isPending 链选择 mutation，失败后立即回退到删除 mutation，错误不显示；⑥P2——新建成功后操作记录滞留 `COMMITTING` 直到租约过期。
  - 修复：③改为钉住 + 备份交换（钉住目标持有 DELETE 访问 → 提交门后复核 → 原文件改名到登记备份 `.cove-note-<uuid>.prev.part` → 不覆盖改名换入 → 身份确认后释放备份，占用则回滚并报错）；②服务端列表/新建/重命名返回前相对化路径；④worker `rename` 支持 `objectId` 校验、删除改走 `delete_object`、服务端与前端比对新鲜 stat 身份（不匹配报 `NOTE_CHANGED`）；①修正调用；⑤弹窗按 dialog kind 选择 mutation；⑥新建成功立即结算为 `SUCCEEDED`。恢复流程支持“路径丢失 + 备份完好 → restore 按身份恢复”与备份身份清理（schema 新增登记 `backup_path` 列 + 迁移 `20260921010000_note_backup_path`）；worker 新增 `restore` 动作。
  - 证据：新增 `apps/server/test/worker-notes.test.py` 10 项——导入真实 worker 模块在内存 SMB 服务器上执行完整控制流（旧代码在此测试下因 P0 TypeError 直接失败），覆盖替换交换、提交后复核、换名竞态不覆盖且保住原文、缺失目标映射、外部读取句柄 FILE_BUSY、rename/delete_object/restore 身份校验、新建与重名冲突；`notes.test.cjs` 61 项（新增恢复 restore、残留备份清理、rename/delete 身份拒绝、路径相对化断言）；web 44 项（新增 `notes-dialog-errors.test.cjs` 2 项）。修正记录：阶段 1 对 worker “已验证的条件原子替换”的描述仅对 mock 契约成立——mock 不执行真实 Python 控制流，③的竞态与①的 TypeError 均由本次用户实测与复审发现。
- 完整逻辑复审修复（2026-09-21）：草稿记录来源 revision，恢复草稿不再借用当前 NAS revision；冲突后可继续本地编辑但提交保持冻结；保存重试区分“网络结果未知”（复用 requestId）与“Server 明确失败”（新 requestId）；恢复对账加入正文 SHA-256 并回填可重放 revision 元数据；临时对象在 `created` 事件即持久登记，新建操作在启动 worker 前建账；恢复查询不再因 `cleanupPending` 误删未过期活动写入；重命名/删除强制要求列表对象身份，打开笔记执行破坏性操作前先 flush；修复子目录重命名传完整路径、文件夹重命名校验/文案、保存后修改时间、图片取消竞态/卸载取消/严格公开 URL/Markdown alt 转义、目录分页及外部控制字符读取。
  - 证据：`notes.test.cjs` 增加 requestId 载荷绑定、临时身份持久化、同身份同长度但哈希不同的恢复冲突、活动操作不清理及身份必填覆盖；`notes-save-queue.test.cjs` 增加草稿原 revision、旧草稿冻结编辑、冲突编辑和 requestId 重试语义；图床与对话框契约测试增加严格 URL、alt 转义和子目录重命名覆盖。真实浏览器与 QNAP 验收仍由维护者执行。
- 交互修订（2026-09-21，阶段 5）：`pnpm --filter @cove/web test` 60 项全部通过（新增 6 项手动模式假时钟用例——含 StrictMode 重新挂载后队列必须复活——与 4 项未保存守卫源码断言）、`pnpm --filter @cove/server test` 63 项（62 通过、1 项既有 MySQL 集成用例按既有约定跳过、0 失败）、`pnpm --filter @cove/web build`、`pnpm lint`、`pnpm typecheck`、`pnpm format:check`、`git diff --check` 全部通过。修正记录：阶段 2 的「`?dir=`/`?note=` 查询参数驱动」与阶段 2/4 的「500ms 草稿、2.5s 防抖、30s 上限自动保存」描述自本次修订起失效，以阶段 5 与更新后的 Spec 为准。待人工验收：树的展开/懒加载、保存按钮与 `Ctrl/Cmd + S`、三种未保存切换选择、刷新后草稿恢复、375/768/1440px 与深浅主题。
- 保存按钮恒不可用修复（2026-09-21，阶段 5）：用户实测「保存按钮始终是灰色」定位到 React StrictMode 的额外挂载周期——`main.tsx` 启用 `React.StrictMode`，开发模式下 effect 会「挂载 → 清理 → 再挂载」，而卸载清理里的 `queue.dispose()` 把存放在组件状态中的保存队列永久置为已销毁（effect 清理比组件生命周期短），`edit()` 与 `flush()` 从此直接返回，`dirty` 恒为 false。修复：`start()` 按「打开/重新打开」语义解除 `disposed`，真实卸载后不会再调用 `start()`；`notes-save-queue.test.cjs` 增加 1 项回归用例（dispose → edit 被忽略 → start → 编辑重新记账并保存一次）。web 测试 60 项全部通过。
- 目录树交互修订（2026-09-21，阶段 5）：把「先在树里选中目录、再点左上角工具栏按钮」的隐藏目标目录模型改为行右键菜单（需求：`NOTE-FR-004`、`NOTE-FR-016`；验证：源码断言与构建）。证据：`notes-page.tsx` 删除 `selectedDir` 状态与工具栏的新建/新建文件夹按钮（工具栏只保留右键提示与刷新），新增 `TreeMenuState` 与 `openRowMenu`（目录行：新建笔记/新建文件夹/重命名/删除；笔记行：重命名/删除；根行只能新建；按权限过滤，无可用操作时不弹空菜单；键盘 ContextMenu 键无坐标时锚定到该行，坐标按视口钳制），菜单项直接作用于被右键的行，新建对话框显示目标目录（`notes.createIn`）；行的悬停图标按钮移除。`docs/behavior/notes.md` 与 `design.md` 同步。
- 编辑区高度链修复（2026-09-21，阶段 5）：用户实测「只有点到正文行才有光标，点下方空白没有焦点」。原因是 MDXEditor 的 `mdxeditor-full-height` 需要容器到 contenteditable 是一条有确定高度的 flex 链，而页面容器只是 `min-h-full`，`.mdxeditor` 高度退化为内容高度，正文下方的空白不属于编辑面。修复：编辑区宿主保留 `flex-1 min-h-0 overflow-y-auto` 作为兜底滚动，`MarkdownEditor` 的 `section` 改为 `flex h-full min-h-0 flex-col`，MDXEditor 根元素补 `min-h-0 flex-1`，滚动交给 `.mdxeditor-root-contenteditable`（`overflow: auto`）。`docs/behavior/notes.md` 记录该行为。
- 树工具栏移除与节点级刷新（2026-09-21，阶段 5）：用户要求去掉树顶部那一栏，并把刷新放进右键菜单且只刷新某个目录节点（需求：`NOTE-FR-004`、`NOTE-FR-015`；验证：源码断言与构建）。证据：`notes-page.tsx` 删除树顶部工具栏（右键提示与全局刷新按钮）与随之无用的 `notes.menuHint` 文案，`openRowMenu` 改为「目录行始终有菜单（含刷新）」；新增 `refreshDir()`，以 `exact: true` 精确失效 `['notes', userId, 'tree', dir]` 只重读该层列表，其他层级缓存保留。
- 富文本粘贴代码块换行修复（2026-09-21，阶段 5）：用户从 Typora 全选复制粘贴后代码块换行丢失（需求：`NOTE-FR-005`、`NOTE-FR-006`）。原因是 Typora/CodeMirror 的剪贴板 HTML 把每行放在独立块级元素里且行间没有换行文本节点，而 MDXEditor 的 `$convertPreElement` 读取 `pre.textContent`，于是整块代码被拼成一行。修复：新增 `features/notes/paste-html.ts`（`normalizePastedHtml`）在导入前按行容器重建换行、丢弃行号/隐藏测量/语言提示等复制装饰、保留块内空行与行内空格，并从 `lang`/`data-language`/类名尽量恢复语言标记；`markdown-editor.tsx` 在**捕获阶段**监听 paste（编辑器自身的剪贴板处理在冒泡阶段、位于 contenteditable 上，晚于捕获阶段），把修正后的 `text/html` 交回本次事件的 DataTransfer（剪贴板负载在 paste 期间只读，故优先改写该次事件的 `getData`，失败时回退 `setData`）。
  - 证据：新增 `apps/web/test/notes-paste-html.test.cjs` 8 项（`joinRuns` 分组合并、包装空行剥离与块内空行保留、Typora 结构逐行还原并剔除行号、语言标记保留、空行（`<br>`）保真、幂等与普通 HTML 原样返回、缩进整理的 HTML 不产生空行且行内空格保留、适配器捕获阶段接线断言）；为此新增 web 首个 DOM 测试依赖 `happy-dom`（devDependency，仅在测试的 VM 上下文中注入 `DOMParser`/`Node`）。web 测试 68 项全部通过，`pnpm --filter @cove/web test`、`typecheck`、`lint`、`build`、`format:check`、`git diff --check` 全绿。`docs/behavior/notes.md` 记录该行为。
- 富文本粘贴代码块换行修复（二）：真实结构定位与模型重写（2026-09-21，阶段 5）。上一轮修复无效的根因来自维护者提供的真实剪贴板数据（`prototype/paste-probe/index.html` 诊断页）：Typora 围栏的行是**行内 `<span>` + `<br>`**，块内没有任何块级子元素，而行间同样没有换行文本 —— 上一轮为了「不碰已经正常的代码块」加的守卫（要求 pre 内存在块级行容器）恰好把这些块全部跳过，于是粘贴结果仍是一整行。数据还暴露了第二处缺陷：以「行容器编号」分组无法表示没有文本的行，块内空行（`<br><br>`）会丢失。
  - 修复：行模型重写为显式 token（`text` / `break` / `end`）—— 显式 `<br>` 必定结束当前行（因此空行可表示）、块级边界仅在行内有内容时结束行（因此包装元素不产生空行）、两端由包装产生的空行剥离；非换行空格（Typora 的缩进填充）还原为普通空格；「是否已正常」改为直接比较重建结果与原 `textContent`（充分且不误伤）。剪贴板改写机制一并换为「重发等价 paste 事件」（构造 `DataTransfer` + `ClipboardEvent` 后派发），因为系统剪贴板负载在 paste 期间只读、就地改写不可靠；无法重建负载时不动原事件，退化为原始粘贴。
  - 证据：`apps/web/test/notes-paste-html.test.cjs` 12 项——新增 `codeLines` 纯函数用例（块边界分行、`<br>` 保留空行、包装空行剥离）、**按真实 Typora 标记构造的围栏 fixture**（`<span>`+`<br>`、`&nbsp;` 缩进、空行、`lang="typescript"`）逐行还原断言、前置 meta 块与围栏共存的文档用例、以及用 happy-dom 派发 `ClipboardEvent` 的**端到端机制用例**（重发事件确实被 contenteditable 上的监听者收到、无需修复时不重发以免重复粘贴）。web 测试 71 项全部通过，`typecheck`、`lint`、`build`、`format:check`、`git diff --check` 全绿。`docs/behavior/notes.md` 同步该行为与机制；`prototype/paste-probe/` 为一次性诊断页，定位完成后可按需删除。
- 围栏代码块高亮（2026-09-21，阶段 5）：此前代码块用刻意去 CodeMirror 的纯文本 textarea，既无高亮也无语言下拉。维护者选择「直接用 MDXEditor 内置 CodeMirror 插件」并接受体积代价（需求：`NOTE-FR-006`、`NOTE-NFR-002`；验证：构建体积对比与源码断言）。
  - 证据：`markdown-editor.tsx` 增加 `codeMirrorPlugin({ codeBlockLanguages, autoLoadLanguageSupport: true })`（语言清单：js/ts/tsx/jsx/vue/json/html/css/python/go/rust/java/sql/bash/shell/yaml/markdown 及别名，语法包按语言动态加载），并保留 priority 0 的 `plainTextCodeEditor` 作为兜底描述符——优先级 1 的 CodeMirror 描述符只匹配清单内语言与未标注语言的围栏，其余语言仍由纯文本编辑器保持可编辑；工具栏改为 `ConditionalContents`，围栏聚焦时显示 `ChangeCodeMirrorLanguage` 语言下拉。`markdown-editor.css` 增加深色主题下代码块表面/文字覆盖（MDXEditor 固定使用 CodeMirror 浅色主题）。
  - 体积（实测，`pnpm --filter @cove/web build`）：主包 2,042 kB → 2,483 kB（gzip 547 kB → 690 kB），另生成 118 个按语言动态加载的资源；维护者已确认接受该代价。注意前端目前没有路由级分包，该增量计入所有页面。
  - 测试：`markdown-roundtrip.test.cjs` 增加 1 项源码断言（CodeMirror 插件启用、语法懒加载、纯文本兜底保留、语言下拉、深色主题覆盖）；web 测试 72 项全部通过，`typecheck`、`lint`、`build`、`format:check`、`git diff --check` 全绿。深浅主题下代码块的实际观感仍待人工确认。
- 复核「有了 CodeMirror 插件是否可以去掉粘贴规范化」（2026-09-21，阶段 5）：不能去掉，已用编辑器真实导入路径验证。`$convertPreElement`（HTML → CodeBlockNode）只读 `pre.textContent`，发生在任何编辑器渲染之前，CodeMirror 插件只决定代码块用什么编辑器*编辑*，不参与导入。证据：在注册了 `codeMirrorPlugin` 的 realm + headless editor 上调用 `$convertPreElement`，原始剪贴板 HTML 的导入结果仍是单行（无 `\n`），规范化后的结果是 7 行且语言保留为 `typescript`。该验证固化为 `apps/web/test/notes-paste-html.test.cjs` 中的回归用例（`the editor import glues <br>-separated fences unless the payload is repaired`，同时断言语言不丢失），web 测试 73 项全部通过；一次性探针脚本已删除。
- 代码块不可见占位字符（2026-09-21，阶段 5）：维护者实测粘贴后「代码区域凡有换行处出现高度超过一行的点状占位」。原因是源编辑器把不可见字符当作占位写进剪贴板（Typora 用零宽空格给空行撑高，其标记正是数据里带 `cm-zwsp` 的 `<span>`），而 CodeMirror 的 `highlightSpecialChars`（`basicSetup` 自带）会把 `­ ​ ‎ ‏ ﻿` 以及 CR 等字符替换成可见的"控制字符"小方块——之前用 textarea 时它们不可见，换成 CodeMirror 后显形。
  - 修复：`paste-html.ts` 在提取代码文本时按 CodeMirror 的同一组字符清理（Unicode 格式/不可见字符用正则，C0/C1 控制字符用码点循环以避开 `no-control-regex`，与 `isPlausibleName` 的既有写法一致），只保留 Tab 与换行；仅含占位字符的行按空行保留，因此空行不会因此丢失。
  - 证据：`notes-paste-html.test.cjs` 新增 1 项（CR/ZWSP/软连字符/占位-only 行），并把真实 Typora fixture 的空白行补上真实的零宽空格；web 测试 74 项全部通过，`lint`、`typecheck`、`build`、`format:check`、`git diff --check` 全绿。已知边界：清理只作用于代码块；此前已保存、正文里已含零宽空格的旧笔记仍会显示方块（需要时可再补一次保存侧清理）。
- 保存后重命名误报冲突（2026-09-21，阶段 5）：维护者实测「修改内容保存后重命名，报『保存到达前，笔记已在 NAS 上被修改』」。定位：保存是原子替换（临时文件换入正式路径），提交后正式路径上是**新的 SMB 对象**；而重命名/删除会校验列表给出的对象身份（`notes.service.ts:762`，不一致即 `NOTE_CHANGED`，复用保存场景的文案）。手动保存改造时我把「保存成功后刷新目录列表」那步删掉了（当时理由是列表不显示大小），于是保存后列表里的 `objectId` 立刻过期 → 重命名带旧身份必被拒绝。证据：修复前该用例中「用保存前的身份重命名」确实被拒。
  - 修复：保存响应新增 `objectId`（提交后由 worker 最终身份校验得出的正式对象身份；未写入时返回当前对象身份），契约写入 `design.md` 的 API 一节；Web 在保存成功后把本地列表项重指向该身份（`notes-page.tsx` 的 `commit`），因此不再需要额外目录列表请求，也没有「刷新未落地就重命名」的竞态。`packages/shared`、`notes.service.ts`（三处返回路径）与客户端同步。
  - 证据：`apps/server/test/notes.test.cjs` 新增 1 项（保存返回 `new-obj-1`；用保存前的身份重命名仍被 `NOTE_CHANGED` 拒绝；用保存返回的身份重命名/删除成功），server 测试 64 项（63 通过、1 项既有 MySQL 用例按约定跳过、0 失败）；`apps/web/test/notes-unsaved-guard.test.cjs` 新增 1 项源码断言（保存后按 `result.objectId` 重指向列表项），web 测试 75 项全部通过；`lint`、`typecheck`、`build`、`format:check`、`git diff --check` 全绿。
- 目录树可折叠、可调宽（2026-09-21，阶段 5）：维护者要求左侧目录树区域支持折叠与宽度调节（需求：`NOTE-FR-004`、`NOTE-NFR-006`）。实现：`notes-page.tsx` 用 `--notes-tree-width` CSS 变量承载宽度（`lg:w-[var(--notes-tree-width)]`，手机端仍是整宽/整屏切换，不受影响），宽度限制 200–520px，默认 280px；分隔条是 `role="separator"` 的可聚焦元素，指针拖动调宽、双击恢复默认、左右方向键按 16px 步进，拖动期间容器为 `cursor-col-resize select-none`；编辑器标题栏左侧提供收起按钮，收起后左侧保留窄栏（展开按钮）以保证随时能回到目录树。宽度与折叠状态按用户存于 `cove.notes.tree.<userId>.width|collapsed`（复用 `@/lib/storage`，与 Files 页偏好一致），不进入 URL。
  - 证据：`apps/web/test/notes-unsaved-guard.test.cjs` 新增 1 项源码断言（偏好键与读写、宽度变量、分隔条角色与命名、收起/展开入口）；web 测试 76 项全部通过，`lint`、`typecheck`、`build`、`format:check`、`git diff --check` 全绿。`design.md` 的页面会话一节与 `docs/behavior/notes.md` 已同步；实际拖动手感与手机端回归待人工确认。
  - 修正记录（同日）：初版收起后保留了一条窄栏并带自己的展开按钮，维护者指出「应整体折叠、按钮原地翻转，不要出现两个按钮」。已改为单按钮原地切换（编辑器标题栏左端；无打开笔记时位于空状态左上角同一位置），收起时目录树区域完全让出，窄栏删除。
- 深色主题下代码块部件残留白底（2026-09-21，阶段 5）：维护者实测语言下拉与代码块行号区在深色主题仍是白色。定位两处浅色硬编码：①MDXEditor 的 `--basePageBg` 全表只在浅色 token 块中定义为 `white`（深色块未覆盖），而下拉（`._selectContainer`）、浮动面板箭头与对话框都用它作背景或填充；②CodeMirror 的 `basicLight` 主题给 `.cm-gutters` 设了浅色背景、给 `.cm-activeLineGutter` 设了高亮背景，此前只覆盖了行号文字颜色。
  - 修复：`markdown-editor.css` 的深色覆盖补齐——`.cm-gutters` 背景透明、`.cm-activeLineGutter` 与 `.cm-activeLine` 一致用 accent 半透明、选区用 primary 半透明；并把 `--basePageBg` 在深色下改为 `hsl(var(--popover))`（弹层容器带有编辑器类名，所以下拉等 portal 内容同样生效）。
  - 证据：`pnpm --filter @cove/web build` 与既有 76 项 web 测试、`format:check`、`git diff --check` 全部通过；深浅主题的实际观感仍待人工确认。
- Notes 侧性能优化：去掉每次请求重复的根目录校验（2026-09-21，阶段 5）。背景：每个 SMB 操作都是一个新 Python worker 进程加一次新的 SMB 会话，而 `entries / content / createFile / createFolder / save` 每次都会先 `ensureRoot()` 去 `stat` 根目录，于是 Notes 的每次操作实际付出两倍固定开销（打开一页笔记 = 4 次冷启动）。实测固定开销：Node 派生约 5ms、Python 解释器约 15ms、`smbprotocol` 的 connection/session/tree/open 约 40ms（合计约 60ms，冷启动约 120ms），NAS 往返另计；把 `connection/session/tree/open` 延迟 import 收益 <10ms，故未采纳。
  - 修复：`notes.service.ts` 为「用户 + 绑定版本 + 配置指纹」记录根目录校验时间，30 秒窗口内直接跳过（`ROOT_VERIFY_TTL_MS`），冲突与创建路径不变，窗口内被外部删除的根目录会在下一个动作重新创建；客户端与 API 契约无改动。
  - 证据：`apps/server/test/notes.test.cjs` 新增 1 项（首次请求校验一次根目录，窗口内的后续请求只发 `list`）；server 测试 65 项（64 通过、1 项既有 MySQL 用例按约定跳过、0 失败），`lint`、`typecheck`、`build`、`format:check`、`git diff --check` 全绿。`docs/behavior/notes.md` 记录 30 秒窗口行为，`docs/architecture/overview.md` 记录实测开销，`docs/product/roadmap.md` 记录「常驻 worker 与会话复用」为后续独立 Spec。
- 图片上传卡片改为浮层、成功即消失（2026-09-21，阶段 5）：维护者要求把上传任务卡片放到编辑器右下角绝对定位，并要求完成的直接消失。实现：`notes-page.tsx` 的上传面板改为编辑区内的绝对定位浮层（`absolute bottom-3 right-3`、宽 72、最多 45dvh 内滚动、`bg-popover` + 阴影，编辑器 `section` 加 `relative`），不再占据正文上方的版面；上传成功后移除该行（`removeUpload`），`ImageUploadRow` 的 `done` 终态与对应文案（`notes.imageUploaded`）随之删除——面板现在只呈现进行中、失败与已取消三类。
  - 证据：`pnpm --filter @cove/web test` 76 项全部通过，`lint`、`typecheck`、`build`、`format:check`、`git diff --check` 全绿；`docs/behavior/notes.md` 同步（浮层位置、成功即消失）。浮层观感与移动端遮挡情况待人工确认。
  - 补充（同日）：维护者确认「不需要的就直接消失」——用户取消的上传同样立即移除（`ImageUploadRow` 只剩 uploading/failed 两态，`notes.imageCancelled` 文案删除，进度条分支简化），被拒绝的图片类型提示改为 6 秒后自行清除（瞬时反馈，不需要关闭）。web 测试 76 项与 `lint`、`typecheck`、`build`、`format:check`、`git diff --check` 保持全绿。
- [ ] 在真实库运行 `pnpm db:seed` 并回归资源管理与角色授权（验收：资源管理出现 `workspace.notes` 与五项权限、自定义角色可授予、旧会话按 seed 语义失效后重新登录）。
  - 发现（2026-09-21，验收当天）：资源管理页没有 Notes 条目，原因是该数据库尚未执行本 spec 的 RBAC seed（资源管理读库、seed 之外没有回退目录）；超级管理员绕过权限校验，所以页面功能看起来正常，掩盖了这一步。机器侧 seed 幂等与权限矩阵由既有测试覆盖，真实库执行只能由维护者完成。
- **验收通过（2026-09-21）**：维护者对当前实现完成真实环境验收（NAS + 浏览器），判定 `NOTE-AC-001` 至 `NOTE-AC-010` 通过；Spec 置为 `Completed`，开放问题 `NOTE-OQ-001/002/003/005` 关闭、`NOTE-OQ-004` 作废。本表与 `spec.md` 保留为交付记录。
