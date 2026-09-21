# 技术设计

## 设计摘要

新增独立 `NotesModule` 与 `/notes` 页面。每个用户通过现有 SMB 绑定访问 home 下固定、可见、非本地化的 `Markdown Notes/`；目录和 `.md` 文件本身构成笔记树，SMB 文件是正文与层级的唯一事实源。

Web 使用能将 Markdown 字符串双向转换为结构化编辑状态的所见即所得编辑器。当前推荐 MDXEditor，但最终依赖必须在批准前通过固定方言的往返、中文输入法、粘贴图片和主题原型验证。Notes 不保存编辑器 JSON 或 HTML。

保存分为浏览器恢复草稿与 SMB 持久化两层。Web 只在用户显式保存时请求写入，输入阶段不触碰 NAS；恢复草稿只在页面卸载与异常刷新时兜底。Server 对每次保存执行带来源版本检查的同目录临时写入与原子替换。MySQL 只保存不可丢的写入操作状态和脱敏审计；首版不保存正文副本或长期全文索引。

## 组件与边界

```text
Browser NotesPage
  ├── lazily expanded note tree / route state
  ├── WYSIWYG Markdown editor
  ├── manual save (button, Ctrl/Cmd+S) and unsaved-switch guard
  ├── IndexedDB recovery drafts
  └── image paste handler
          │
          ├──── /api/notes ───► NotesModule
          │                       ├── note policy/path boundary
          │                       ├── save state machine
          │                       └── FilesModule exports
          │                              ├── SmbBindingsService
          │                              ├── FilesConfig
          │                              └── SmbAdapter ───► NAS home/Markdown Notes
          │
          └──── /api/images ──► existing ImagesModule ─────► NAS home/Image Hosting
```

- `NotesController`：JWT、权限声明、输入转换、缓存头和 HTTP 错误映射。
- `NotesService`：目录用例、来源版本、保存状态机、审计和故障恢复。
- `NotesPolicy`：固定根目录、扩展名、名称、编码、大小和 Markdown 输入边界。
- `SmbAdapter` / Python worker：新增笔记小文件读取和带来源身份的安全替换操作；不得把 SMB 凭据传给浏览器。
- `NotesPage`：目录树与当前文件状态、手动保存编排、未保存切换守卫、冲突 UI、页面会话集成。
- `MarkdownEditor`：隔离第三方编辑器 API，只暴露 Markdown、dirty 状态、图片上传回调与聚焦/销毁方法，降低以后更换组件的成本。
- `ImagesModule`：继续拥有图片验证、上传、公开、撤销、匿名读取和限流。Notes Web 只调用现有公开契约，不直接访问 SMB 图片目录。

NotesModule 导入 FilesModule 以复用已导出的配置、绑定和 SMB adapter。它不通过 FilesController 绕行，也不接受 Files 页面的通用任意路径。

## 存储布局与路径

```text
<SMB home>/
  Markdown Notes/
    工作/
      项目计划.md
    未命名笔记.md
    .cove-note-<uuid>.part
  Image Hosting/
    ... existing image assets ...
```

- 功能根目录遵循现有 `Image Hosting/` 的先例：直接位于 SMB home、固定英文 ASCII 名称、Title Case、普通可见且不随界面语言变化。Notes 根目录固定为 `Markdown Notes/`。
- API 中的路径相对于 `Markdown Notes/`；Server 负责拼接固定根目录，客户端不能覆盖根目录名称。
- 如果 `Markdown Notes/` 已存在且是普通目录，Cove 直接采用且不改写内容；同名对象是文件、链接或不支持对象时返回 `NOTES_ROOT_CONFLICT`，不得自动删除或替换。
- 列表只返回普通目录和支持的 `.md` 文件；应用临时文件、隐藏文件、链接/reparse point 和其他扩展名不作为笔记。
- 文件名是首版唯一标题，不在正文或数据库维护第二个标题。标题修改映射为同目录不覆盖重命名。
- 文件夹是实际 SMB 目录。首版不支持跨目录移动和递归删除。
- 新建同名文件时 Server 返回冲突；Web 可以建议 `未命名笔记 2.md`，但不得在用户未确认时改写已有文件。
- 用户文件或目录不得使用应用保留的 `.cove-` 前缀；临时文件固定使用 `.cove-note-<uuid>.part`，只按登记路径与对象身份清理。
- 目录名中的普通内部空格受支持，但拒绝控制字符、尾随空格、尾随句点、仅由空格组成的名称及其他跨平台危险名称。URL 使用标准编码，代码不得以 shell 参数分词处理路径。
- UTF-8、BOM 与换行规范化在 `NOTE-OQ-003` 关闭后固定；无效输入只读提示或拒绝打开，不得替换原文件。

## 编辑器与 Markdown 方言

第三方编辑器通过仓库内 `MarkdownEditor` adapter 隔离。批准前建立至少包含以下内容的 fixture 集合：

- 中英文段落、组合输入和 emoji；
- 六级标题、粗体、斜体、删除线与嵌套标记；
- 多级有序/无序列表和任务列表；
- 引用、水平线、转义字符与相对/绝对链接；
- 带语言的围栏代码块；
- GFM 表格；
- 公开图床 Markdown 图片；
- 明确禁止的原始 HTML、MDX/JSX 和未知扩展。

测试分别验证初次导入后无编辑导出、局部编辑后导出、撤销/重做、复制粘贴和重复打开。语法等价的格式规范化可以接受，但任何文本、节点或链接语义丢失均阻止批准。

若选择 MDXEditor：

- 只启用批准方言所需插件，不启用 MDX、JSX 或表达式执行。
- 使用 `imagePlugin.imageUploadHandler` 接入图床。
- 禁用图片尺寸调整，避免序列化为 HTML `<img>`。
- 通过 ref 的 `getMarkdown` / `setMarkdown` 在文件切换时显式装载，避免把受控 React state 每次输入回灌编辑器。

围栏代码块的编辑与高亮（2026-09-21 修订）：

- 语言在批准清单内（js/ts/tsx/jsx/vue/json/html/css/python/go/rust/java/sql/bash/shell/yaml/markdown 及其常见别名）或未标注语言的围栏，使用 MDXEditor 内置的 CodeMirror 编辑器：真实语法高亮、行号、语言下拉，语法包按语言从 CodeMirror language-data 动态加载，只有打开该围栏时才下载。
- 语言不在清单内的围栏继续使用纯文本编辑器（`PlainTextCodeEditor`，priority 0 兜底），保证任何围栏都可编辑，不会因为没有语法包而变成只读。
- MDXEditor 的代码块主题固定为浅色，因此深浅主题下由 `markdown-editor.css` 覆盖编辑器表面与基础文字颜色（`!important`，因为主题规则是生成的更高优先级类）。
- 体积代价已由维护者确认接受：主包 2,042 kB → 2,483 kB（gzip 547 kB → 690 kB），另有按语言动态加载的语法 chunk。

## 数据模型

SMB 文件是笔记事实源，不新增 `Note` 正文表。为恢复未知提交结果，建议新增最小持久化状态：

```text
NoteWriteOperation
- id                    UUID
- userId
- bindingVersion
- configFingerprint
- authVersion
- relativePath          Markdown Notes 内目标路径
- tempPath              已登记临时路径
- sourceRevisionHash    打开时不透明版本的服务端摘要
- sourceObjectId
- sourceModifiedAt
- sourceSizeBytes
- targetObjectId        临时文件对象身份
- targetSha256
- targetSizeBytes
- state                 PREPARING | COMMITTING | RECONCILING |
                        SUCCEEDED | CONFLICT | FAILED | INTERRUPTED
- errorCode
- cleanupPending
- leaseExpiresAt
- createdAt
- updatedAt
```

操作记录不保存 Markdown 正文。临时文件是恢复时的新正文候选；只有路径、对象身份、长度和 SHA-256 全部符合登记值时才能确认为新版本。

操作完成且无需清理的记录按有限保留期删除。绑定删除或替换后无法使用旧凭据清理时保留待处理摘要，不得向新 SMB 目标发送旧密码。

## API 契约

建议契约如下，具体字段在批准前以共享类型固定：

```text
GET    /api/notes/status
GET    /api/notes/entries?path=&cursor=
GET    /api/notes/content?path=
POST   /api/notes
POST   /api/notes/folders
PATCH  /api/notes/content
PATCH  /api/notes/rename
DELETE /api/notes/entries
GET    /api/notes/operations/:id
```

读取正文返回：

```json
{
  "path": "工作/项目计划.md",
  "markdown": "# 项目计划\n",
  "revision": "opaque-server-token",
  "sizeBytes": "13",
  "modifiedAt": "2026-09-21T00:00:00.000Z"
}
```

保存请求：

```json
{
  "path": "工作/项目计划.md",
  "markdown": "# 新项目计划\n",
  "expectedRevision": "opaque-server-token",
  "requestId": "uuid"
}
```

成功响应返回新 `revision`，以及**提交后该笔记的 SMB 对象身份** `objectId`：

```json
{
  "path": "工作/项目计划.md",
  "revision": "opaque-server-token",
  "saved": true,
  "operationId": "uuid",
  "sizeBytes": "16",
  "modifiedAt": "2026-09-21T00:00:01.000Z",
  "objectId": "smb-object-identity"
}
```

保存是一次原子替换，提交后正式路径上是一个新对象；重命名与删除都会校验列表给出的对象身份（`NOTE-NFR-003`），因此客户端必须用这里返回的 `objectId` 更新本地列表项，否则保存后立刻重命名/删除会拿到过期身份并被拒绝为 `NOTE_CHANGED`。未发生写入（内容未变化）时返回当前对象的身份，客户端可原样覆盖。

来源变化统一返回 `409 NOTE_CHANGED`，路径已移动或删除可以提供更具体、但不得泄漏其他路径存在性的安全错误。重复 `requestId` 必须返回同一已知操作结果，避免浏览器重试产生第二次替换。

正文、目录和状态接口使用 `Cache-Control: no-store`。列表分页和目录大小上限复用 Files 已有原则，但使用 Notes 独立配置与错误码。

## 来源版本与安全替换

打开文件时，Server 在一次受控读取中取得：

```text
bindingVersion
configFingerprint
relativePath
SMB objectId
modifiedAt
sizeBytes
sha256(content)
```

Server 将这些信息签名或保存在不可伪造的不透明 revision 中。保存不能只比较客户端提供的修改时间。

提交顺序：

1. 重新验证用户、权限、绑定版本和目标路径。
2. 以不覆盖方式创建同目录登记的 `.cove-note-<uuid>.part`。
3. 完整写入 Markdown，校验字节数与 SHA-256，并 flush。
4. 在目标 QNAP 已验证的 SMB 共享/锁定语义下，对正式文件重新确认来源对象与 revision。
5. 将操作持久化为 `COMMITTING`。
6. 以身份条件执行替换交换：先把仍被钉住的正式对象改名为同目录登记的 `.cove-note-<uuid>.prev.part` 备份，再用不覆盖改名让临时对象占用正式路径；若正式路径在该瞬间被外部占用，回滚备份并报错，绝不静默覆盖。
7. 以新对象身份确认结果后释放备份；备份无法立即释放时保留它，由服务端按登记身份异步清理。
8. 以新对象身份、长度和摘要确认结果，返回新 revision。

步骤 4 至 6 的原子性必须通过目标 QNAP 技术验证关闭 `NOTE-OQ-002`。钉住目标需要 DELETE 访问权；持有旧内容且未共享删除的外部读取句柄会使钉住失败并返回可重试的 `FILE_BUSY`，而不是继续覆盖。若 SMB 库无法实现带来源条件的替换，应重新设计为可证明安全的共享锁/byte-range lock 或停止批准，而不是使用“stat 后直接覆盖”的竞态方案。

恢复时：

- `PREPARING` 过期：只按登记对象身份清理临时文件，原文件不变。
- `COMMITTING` 过期：进入 `RECONCILING`，检查正式路径的新对象身份、长度和摘要。
- 正式文件完全等于登记的新对象：确认成功，并按登记身份清理临时文件与备份。
- 正式文件仍等于登记的旧来源且临时对象仍在：保留原文件、清理临时文件与备份并标记中断。
- 正式路径不存在且登记备份等于旧来源身份：用 `restore` 动作按身份校验把备份恢复回正式路径并标记中断；恢复遇到占用则标记冲突并保留备份。
- 正式文件属于未知对象或状态无法证明：标记冲突并停止自动写入或删除；登记备份保留在 NAS 上，作为被替换笔记最后一份已知内容。

## 手动保存与浏览器草稿

保存是显式动作：工具栏保存按钮与 `Ctrl/Cmd + S` 都调用同一条 `flush()` 路径，输入本身不产生任何 SMB 请求。保存队列以 `autoSave: false` 运行——编辑只把笔记标记为未保存（`pending`），不再安排草稿定时器、防抖提交或周期提交；`flush()` 即「立即保存」，失败后同一按钮重试。

保存队列实例存放于组件状态，其生命周期长于单个 effect：`start()` 是「打开/重新打开」语义，必须同时解除 `dispose()` 标记，否则 React StrictMode 在开发模式额外执行的「挂载 → 清理 → 再挂载」会把队列永久置为已销毁，编辑不再被记录、保存按钮恒为不可用。

Web 保存队列维护 `editorRevision`、`persistedRevision`、`inFlightRevision` 和当前 Markdown hash。同一笔记最多一个 SMB 保存请求，输入变化只更新队列中的最新候选；hash 与已持久化版本相同则跳过 SMB 写入。

未保存时离开当前笔记会先弹窗询问：**保存并切换**（保存失败则留在弹窗并显示错误码）、**放弃修改直接切换**（同时删除该笔记的恢复草稿）、**留在当前笔记**。移动端返回按钮走同一守卫。重命名或删除当前打开的笔记属于破坏性操作，会先提交未保存内容，保存失败则中止该操作。

IndexedDB key 至少包含 Cove origin、用户 ID、绑定版本和笔记路径。草稿记录包含基础 revision、Markdown、时间和内容 hash，不包含 SMB 凭据或 token。草稿只在页面卸载、`pagehide`/页面隐藏等异常刷新场景作为兜底写入（用户显式放弃的笔记不写）；成功保存匹配内容后删除；登出、401、强制改密和认证用户 ID 改变时清除上一用户草稿。

页面卸载不能保证异步 SMB 请求完成，因此未确认内容继续依赖 IndexedDB 恢复，不使用 `sendBeacon` 绕过正常鉴权和版本检查。

## 图片粘贴与公开

编辑器图片上传 adapter 复用现有两阶段图床 API：

1. 从剪贴板或拖放事件取得 `File`。
2. 调用 `POST /api/images/uploads`，对该次请求传递 `publish: true`。
3. 调用 `PUT /api/images/uploads/:id/content` 并显示实际传输进度。
4. 等待 ImagesModule 完成内容解析、SMB 原子提交和公开 grant 创建。
5. 将返回的同源 `/image/{publicId}` 交给编辑器，序列化成标准 Markdown 图片语法。

上传期间编辑器使用纯 UI 占位，不将临时地址写入 Markdown。图片上传成功但用户随后撤销、关闭或保存失败时，图片仍作为图床资产保留；Notes 不拥有或自动回收它。

Notes 页面需要自己的页面/编辑权限；图片粘贴额外要求现有图床 page、upload 与 publish 权限，最终权限组合由 `NOTE-OQ-005` 固定。Server 继续独立检查每一个图床动作。

公开图片继续使用当前 60 秒 revalidation、ETag、匿名限流和撤销语义。本 Spec 不增加 CDN、内存正文缓存、公开缩略图或更长缓存期。

## 机械硬盘访问策略

- 目录树每一层单独枚举元数据，只为展开的层级请求；不为生成摘要而打开全部正文。
- 正文按打开需求读取，不在后台持续轮询所有文件。
- 输入阶段不触碰 NAS：写入只发生在用户显式保存或破坏性操作前的提交，且经内容 hash 去重。
- 每次 SMB 保存仍重写完整小文件，以换取简单、可验证的原子提交；首版不做随机写或增量 patch。
- 不为每次保存创建历史快照。
- 图片继续依赖浏览器和图床既有缓存；编辑器不得为布局测量重复绕过缓存下载同一公开图片。
- 自动刷新在页面后台或页面会话隐藏时停止；外部变化以手动刷新和保存时版本检查为准。

这一策略主要降低频繁唤醒、元数据操作和随机寻道，而不是依赖不可验证的硬盘寿命假设。

## 安全与权限

建议资源代码为 `workspace.notes`，首版权限候选：

```text
workspace.notes.page
workspace.notes.create
workspace.notes.update
workspace.notes.rename
workspace.notes.delete
```

- Server 始终从 JWT actor 派生用户；超级管理员的权限绕过不构成跨用户笔记浏览入口。
- Notes 只处理固定根目录下的普通文件/目录，复用并收紧 Files 路径校验。
- 原始 HTML、MDX、JSX、脚本、事件属性和危险 URL 协议不进入批准 Markdown 方言。
- 公共图片只能由 ImagesModule 生成不可猜测 public ID；Markdown 不保存 asset 私有 ID、SMB 路径或凭据。
- 审计记录用户/操作 ID、安全路径摘要、结果码和耗时，不记录正文、剪贴板内容或图床 secret。
- Web 错误提示不显示 Python traceback 或原始 SMB 状态。

## 页面会话与交互状态

- Notes 是顶级 routeId，融入现有页面会话保活；当前笔记位置保存在完整 `pathname + search + hash` 中。
- 建议地址为 `/notes?note=<encoded-relative-path>`；直接 URL 仍需权限和路径校验。
- 页面为全高布局：左侧是可逐层展开的目录树，右侧是编辑器；手机端在树与编辑器之间单栏切换，返回同样经过未保存守卫。树的展开状态是本地 UI 状态，打开笔记时自动展开其所在路径。宽屏上目录树可折叠、可拖动调宽（200–520px，双击恢复默认），宽度与折叠状态作为每用户浏览器偏好保存（`cove.notes.tree.<userId>`）——与页面会话位置无关，因此不进入 URL。
- 目录树的行操作（新建笔记/文件夹、重命名、删除）由行右键菜单提供，操作对象即被右键的行，因此页面不需要额外的「当前目标目录」选择状态；菜单项按权限过滤，键盘 ContextMenu 键触发时锚定到该行。
- 切换 Cove 顶部页面会话时 Notes 保持挂载，编辑器和未保存状态保留。
- 关闭 Notes 页面会话会卸载编辑器，但不得宣称未完成的 SMB 请求已取消；未确认内容依赖恢复草稿。
- 权限收缩、退出、401、强制改密和用户变化时，释放编辑器、清除私有 Query 缓存与上一身份草稿。

## 本地开发与生产部署

- 本地开发继续使用模拟或测试 SMB adapter；真实 QNAP 的原子替换和中断场景需要单独 live 验证。
- 新配置写入 `apps/server/.env.example`，例如笔记根目录名称、最大字节数、操作租约和记录保留期；不新增浏览器 secret。
- Docker 单应用镜像需要包含新增编辑器前端依赖，但不改变端口、外部 MySQL 或 SMB Python 进程拓扑。
- 第三方编辑器版本固定在 lockfile；批准前检查许可证、bundle 影响和已知安全问题。

## 迁移与兼容性

没有旧 Notes 数据需要迁移。首次访问只创建固定根目录，不移动用户 home 中已有的其他 `.md` 文件。

如果用户已手工创建 `Markdown Notes/`，Cove 读取其中支持的内容，不重写文件，直到用户实际编辑并保存。遇到不支持或往返不安全的文件时保持原字节不变并给出说明。

回滚 NotesModule、导航、RBAC seed 和相关数据库迁移后，SMB 中的普通 Markdown 和图床图片仍保留；回滚不得删除用户内容。未完成的 `.cove-note-*` 临时文件按登记操作和维护说明处理。

## 可观测性

- 记录创建、保存开始/完成/冲突、重命名、删除和恢复状态的脱敏审计。
- 指标至少区分正文读取次数/字节、SMB 保存次数/字节、跳过的相同内容保存、冲突、恢复、失败和图片上传结果。
- 不按每次键盘输入记录日志或指标。
- 维护者可利用保存次数与字节判断机械盘工作负载，但不得在 UI 中给出未经硬件数据支持的寿命预测。

## 备选方案

### MySQL 保存正文

事务、搜索和版本管理更简单，但普通 Markdown 不再是 NAS 上可直接操作的事实源，也让 Notes 脱离 Files/SMB 工作流，因此不采用。

### 直接覆盖原 Markdown 文件

实现简单，但中断可能截断正式文件，并且无法安全处理外部编辑，不能满足数据完整性要求。

### 每次输入立即写 SMB

恢复窗口最小，但产生不必要的小文件写入、临时文件和磁盘唤醒；改为显式保存，未保存内容由恢复草稿兜底。

### Milkdown Crepe

更接近 Typora 的 Markdown-first 体验并提供 React 支持。若其往返语料、图片上传、中文输入法、主题和维护性测试优于 MDXEditor，可以在批准前替换推荐方案，不改变服务端契约。

### Tiptap Markdown

扩展能力强，但当前 Markdown 扩展仍需要额外验证成熟度；首版不优先采用。

## 待决策项

- 关闭 `NOTE-OQ-001` 至 `NOTE-OQ-005` 后才能将 Spec 改为 `Approved`。
- 编辑器选择必须基于仓库内原型与固定语料结果，而不是只依据演示页面观感。
- QNAP 条件替换无法验证时，必须重新评审保存协议，不能降低为有竞态的覆盖保存。
