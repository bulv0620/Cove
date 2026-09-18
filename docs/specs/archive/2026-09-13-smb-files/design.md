# 技术与交互设计

> 本文保留本次实施设计，最终行为以 [Files 行为](../../../behavior/files.md) 为准。实施差异与验证见 [tasks.md](tasks.md)。

## 设计摘要

```text
Browser（Cove 登录身份）
  │ HTTPS /api/files（JWT；原生下载使用短期受限 cookie）
  ▼
NestJS FilesModule
  ├─ 当前用户 + RBAC + 绑定版本校验
  ├─ SmbBindingService → MySQL（加密凭据）
  ├─ FileOperationService → MySQL（传输状态）
  └─ SmbAdapter → TCP 445 / SMB3 加密 → NAS 个人 share
                                        ├─ 身份 alice → alice 的 home
                                        └─ 身份 bob   → bob 的 home
```

Cove 只负责访问代理，不保存第二份完整文件，不创建 NAS 用户。NAS 文件和 ACL 是文件事实源，MySQL 不做完整目录索引。个人目录是 SMB 身份的视图，不能简单将 Cove username 拼到 `homes/` 后作为隔离手段。

若 NAS 是 Synology，官方区分用户个人 `home` 和包含各用户目录的 `homes`；这支持默认以个人共享作为入口的设计，但本项目具体 NAS 尚未确认。[Synology 用户主目录说明](https://kb.synology.com/en-us/DSM/tutorial/user_enable_home_service)。

## 页面与操作

沿用现有布局、主题 token、字体、Lucide 图标与国际化。技能检索中的通用单列营销布局不适合文件浏览，采用高密度工具界面；Files 不显示独立“我的文件”标题和描述。该路由的 main 固定占用顶部栏以下的视口，文件管理器以全高 flex 容器填满 main；页面本身不滚动，文件列表使用内部滚动。

桌面主区域：

```text
┌──────────────────────────────────────────────────────────┐
│ ← → ↑ 刷新 │ 我的文件 > Documents          搜索当前文件夹 │
│ 上传文件  新建文件夹 │ 下载 │ 排序  列表/图标  显示隐藏项 │
├───────────────┬──────────────────────────────────────────┤
│ 我的文件      │ 名称                 修改时间   类型 大小 │
│ ▾ Documents   │ ▸ Projects            …          文件夹 — │
│   ▸ Projects  │   notes.txt           …          文本  2KB│
│ ▸ Photos      │   report.pdf          …          PDF  3MB │
├───────────────┴──────────────────────────────────────────┤
│ 3 个项目 · 已选 1 个                           检查通过   │
└──────────────────────────────────────────────────────────┘
```

- 目录树不常驻占用主区宽度。刷新按钮右侧提供目录树图标按钮，点击后在其下方打开约 288px 宽、最高不超过视口约一半的浮层；仅展示文件夹并按需展开，树内容独立滚动。选择目录、点击外部或按 Esc 关闭浮层。可选详情弹窗展示单文件名称、大小、类型、时间和相对位置。
- 文件类型图标仅根据文件名最后一个扩展名进行本地展示，不读取文件内容或依赖服务端 MIME 探测。文档/PDF、表格、演示、图片、视频、音频、压缩包和代码分别使用 Lucide 图标与主题兼容的语义颜色；目录与未知文件保留稳定回退图标，扩展名匹配不区分大小写。
- 普通点击单选，Ctrl/Cmd 点击切换单项，Shift 点击连续范围；每个列表行和图标项提供独立选择控件，触屏无需键盘修饰键即可多选。选中状态同时使用背景、勾选图标、数量文字和 `aria-selected` 表达。
- 双击/Enter 打开当前目录或文件详情；右键菜单以触发项为目标。方向键移动时恢复为当前项单选，Esc 清空全部选择。工具栏下载只在恰好选中一个受支持文件时可用；不展示尚未实现的复制或多选下载按钮。
- 单选受支持对象时，工具栏、右键菜单和 F2 提供“重命名”，弹窗预填原名称并仅接受新的单文件名；Server 固定父目录并使用 SMB 不覆盖 rename。一个或多个受支持对象选中时，工具栏、右键菜单和 Delete 键打开永久删除确认弹窗，显示数量和对象名称；删除按钮使用危险语义色。删除文件和空文件夹，不递归删除非空目录。批量删除逐项执行并返回成功路径与失败码，界面保留失败项、刷新真实列表并明确部分失败。
- URL 为 `/files?path=Documents%2FProjects`；API 传相对路径，根为空字符串。返回保留滚动、排序；换目录清除选择和筛选，视图偏好按用户存储。退出/换用户清空目录缓存。
- 当前目录筛选有 250ms 防抖，不递归搜索；名称、修改时间、大小、类型支持排序，目录始终优先；图标视图使用类型图标，不加载缩略图。
- 隐藏文件默认隐藏，提供“显示隐藏项”；产品自己的上传临时文件永不作为普通条目展示。隐藏文件不是安全边界。
- 传输入口紧邻搜索框右侧，使用带可访问名称的 Lucide 图标按钮；活跃数量通过按钮角标展示。点击入口或添加上传后打开传输弹窗，不在文件管理器下方插入额外内容区。
- 768px 与 375px 沿用同一个目录树浮层，并限制其宽度不超过视口可用宽度；375px 文件列表只保留名称和次要元数据，上传按钮保持可达。触摸目标至少 44px，正文 16px，避免横向整页滚动。
- 键盘支持 Tab、方向键、Enter、Esc，按钮具备可访问名称；表头 `aria-sort`，进度与错误通过 live region 通知。无需依赖鼠标悬浮。
- 列表加载使用骨架，空目录可上传/新建，筛选空结果允许清空筛选；刷新失败保留旧列表并标注过期，不显示“空目录”。

### 用户管理绑定面板

在用户列表增加 SMB 状态列。操作列分别提供“管理”和“SMB 账号”两个按钮，各自打开独立弹窗，SMB 表单不进入普通用户资料、角色和账号状态的编辑弹窗。SMB 弹窗字段为 SMB 用户名、密码；domain 从 env 统一读取，仅只读展示。显示共享逻辑名称和“此账号的个人目录”，不允许填写任意路径。

新建/修改流程：填写 → 测试连接（不写库）→ 保存（重新测试同一份提交值）→ 成功后更新状态。单独测试失败与保存失败均不破坏旧绑定；测试成功不保证稍后保存必然成功。测试只验证认证及根目录可读，不通过写临时文件推断所有目录可写。

已绑定展示用户名、最近验证时间及最近检查结果；密码永不回填，更新必须重新输入。解绑需确认“将停止该用户 Files 访问，NAS 文件不会删除”。仅本地改密/重置 Cove 密码不会改 SMB 密码；NAS 改密后须更新绑定。

状态拆分为绑定存在性与运行检查结果，避免把上次成功显示成持续在线。连接测试成功使用带勾图标、成功文字和绿色语义样式；失败使用错误图标、可恢复的错误文字和红色语义样式，屏幕阅读器分别通过 status/alert 获知结果，不以颜色作为唯一提示。网络超时保留绑定，凭据错误提示重新绑定。无绑定管理权限的用户只看自己的状态及联系管理员引导。

## 模块、适配器与连接

新增 FilesModule，内部拆分 controller、binding service、path policy、transfer service、credential cipher、SMB adapter。身份生命周期通过明确 service/event 依赖触发传输取消和连接失效，不在 identity 中编写 SMB 操作。

适配器必须提供 connect/list/stat/readStream/createExclusive/writeStream/renameNoReplace/mkdir/delete/close，以及临时文件清理能力。用户删除与临时文件清理使用不同动作：前者只处理经过权限和路径校验的文件或空文件夹，后者还需核对操作登记及对象身份。

优先选择支持结构化目录结果、SMB3 加密、背压与取消的维护中库；具体依赖在探索验证后锁定版本与许可证。禁止直接选一个名称为 smb2 的包就假设满足能力。Samba `smbclient` 可用于协议诊断，官方提供加密策略，但命令输出解析、特殊文件名和进程凭据管理增加集成成本，不作为默认业务接口。[Samba smbclient 官方手册](https://www.samba.org/samba/docs/current/man-html/smbclient.1.html)。

不使用宿主机特权 CIFS 挂载。默认一个 API 实例、有限连接池，连接按 `(userId, bindingVersion, configFingerprint)` 隔离，空闲 60 秒回收；不能跨用户复用 SMB 会话。等待槽位超过 15 秒返回限流错误；文件数据流可以持续，但不得阻塞 Node 事件循环，持久化操作支持取消与观察。扩展到多实例前需要分布式租约和取消通知。

## 数据模型

| 模型           | 主要字段                                                                                                                                                            | 规则                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| SmbBinding     | userId(PK/FK)、username、ciphertext、nonce、authTag、keyId、version、configFingerprint、lastCheckedAt、lastCheckCode、createdAt/updatedAt                           | 一用户一行；删用户级联；密码不在普通 User DTO；版本用于使旧任务失效 |
| FileOperation  | id、userId、bindingVersion、configFingerprint、kind、relativePath、tempPath、expectedBytes、transferredBytes、state、errorCode、leaseExpiresAt、createdAt/updatedAt | 只保存安全元数据，不保存文件内容/凭据；路径不写入常规日志           |
| DownloadTicket | id、secretHash、userId、authVersion、bindingVersion、configFingerprint、relativePath、expiresAt、consumedAt                                                         | 一次性授权，60 秒 TTL；仅保存随机 secret 的哈希                     |

密码使用 AES-256-GCM，每次写入随机 nonce，AAD 包含 userId、bindingVersion 和 configFingerprint，防止跨行调包。独立主密钥与 JWT_SECRET 分离，API 响应不返回密文/nonce/tag。绑定更新使用版本条件写，避免并发更新丢失。

configFingerprint 包含 host、port、share、domain、安全策略；修改 NAS 目标后原绑定标为需要重新验证，禁止把旧密码自动发给新目标。密钥轮换保留受限旧 keyId → key 映射完成重加密后移除旧钥；丢失密钥不回退明文，用户重新绑定。数据库备份与 env 密钥分开保护。

## API 契约

统一前缀 `/api`；复用 JWT 和强制改密规则。文件 API 不接受 userId；路径来自用户相对位置，身份由服务端会话决定。

| 方法与路径                       | 请求/响应摘要                                                              | 权限                                        |
| -------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| GET /users/:id/smb-binding       | 绑定摘要，无密码/密文                                                      | identity.user.page + identity.user.bind_smb |
| POST /users/:id/smb-binding/test | username/password；返回测试结果，不写绑定                                  | 同上                                        |
| PUT /users/:id/smb-binding       | username/password/expectedVersion；重新验证后保存                          | 同上                                        |
| DELETE /users/:id/smb-binding    | 解绑，重复调用可安全返回 204                                               | 同上                                        |
| GET /files/status                | enabled、bindingState、lastCheck、capabilities                             | infra.files.page                            |
| GET /files/entries               | path、cursor、limit(默认200，上限500)、sort、direction、filter、showHidden | infra.files.page                            |
| GET /files/stat                  | path；返回条目元数据                                                       | infra.files.page                            |
| POST /files/directories          | parentPath/name；返回创建目录                                              | page + infra.files.mkdir                    |
| PATCH /files/entries             | path/name；同父目录不覆盖重命名，返回新条目                                | page + infra.files.rename                   |
| DELETE /files/entries            | paths（最多 100）；返回 deleted 与 failed，删除文件或空文件夹              | page + infra.files.delete                   |
| POST /files/uploads              | parentPath/name/size/requestId；返回 operationId                           | page + infra.files.upload                   |
| PUT /files/uploads/:id/content   | application/octet-stream；流式上传，成功提交返回元数据                     | page + upload + owner/version               |
| GET /files/operations/:id        | 状态、字节、错误码                                                         | page + owner；取消/查询仍检查用户状态       |
| DELETE /files/uploads/:id        | 取消自己的未完成上传                                                       | page + owner                                |
| POST /files/download-tickets     | path；返回不含 secret 的 content URL，secret 写入受限 cookie               | page + infra.files.download                 |
| GET /files/downloads/:id/content | 消费 cookie 票据，输出文件字节                                             | 专用票据认证 + 当前用户/动作权限重新校验    |

权限缩写 page 为 `infra.files.page`。新增权限使用现有资源/页面/动作层级 seed 幂等写入，既有普通角色不自动获得新增写入或绑定权限。所有文件动作都需页面权限与 NAS 实际 ACL；capabilities 只说明平台允许的动作，不能当作目标目录可写保证。

目录返回 `{path, entries, nextCursor, snapshotId}`，条目含 `name, relativePath, type, sizeBytes, modifiedAt`。大整数 sizeBytes 使用十进制字符串，时间为 UTC ISO8601。目录快照属于用户、绑定版本和路径，最长 30 秒，游标不允许切换身份/条件；到期或刷新重新枚举，不能承诺 NAS 外部修改下的强一致。

## 下载与认证

现有 Web API helper 面向 JSON/JWT，文件传输需要独立入口。上传用 XHR 或可观察字节的流实现进度，不能走 JSON helper；上传到 Server 的进度不等于 NAS 提交完成。

下载先用 JWT POST 创建票据，再通过隐藏表单/原生导航 GET 内容。响应设置随机 secret 的 `HttpOnly; Secure; SameSite=Strict` cookie，Path 精确到 `/api/files/downloads/:id/content`，60 秒有效；URL 只有非秘密票据 ID。服务端原子消费票据并重新验证用户启用、authVersion、绑定版本及 Files 权限。此内容路由通过专用守卫替代 JWT header 守卫，不是匿名放行。开发 HTTP cookie 例外仅允许显式本地开发配置，生产必须 Secure。

内容响应 `Content-Disposition: attachment`、安全处理 ASCII fallback 与 RFC5987 filename、`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`。不内联呈现 HTML/SVG，不提前整文件落盘或生成 Blob。

第一期不支持 Range/自动续传，返回完整 200 且不宣称 Accept-Ranges；中断后重新点击下载生成新票据。下载审计“服务端传输完成”不代表已确认浏览器落盘。已发响应头后 SMB 出错应终止流并记录失败，不能追加 JSON 或标记成功。

## 上传、冲突和失败恢复

1. 创建操作时验证名称/大小/权限及额度，记录当前绑定版本和目标目录；requestId 在用户与绑定版本内幂等，避免双击生成重复任务。
2. 文件逐个排队，最多两个活跃数据流（上传和下载合计）。离开目录不改变队列目标。应用内换页可继续；刷新、退出或关闭浏览器会中断，页面明确提示，重开后只能手动重传。
3. 在目标目录独占创建保留前缀 `.cove-upload-<uuid>.part`；实际长度逐块校验，拒绝超出声明或配置上限，零字节文件也须正式提交。
4. 客户端完成发送后状态进入 COMMITTING。NAS flush/close 成功、长度一致后，通过同目录原子不覆盖 rename 提交。存在检查不是并发保护，必须使用 NAS/适配器提供的不覆盖语义；不具备该能力就不能通过准入验证。
5. 同名返回 409，UI 提供跳过或用户输入新名称后重试；第一期不覆盖，不做“先删旧文件再改名”。取消只清理自己操作登记的临时对象，不能删除用户目标文件。
6. 状态：QUEUED → RUNNING → COMMITTING → SUCCEEDED；旁路为 FAILED/CANCELED/INTERRUPTED，提交结果不明进入 RECONCILING。取消和提交通过租约/条件更新串行化；一旦提交成功，取消返回已完成。
7. 重启扫描过期租约。提交前保存临时对象稳定标识；如 NAS/库无法稳定核对 rename 后对象身份，结果不明确时展示“待核对”，不凭同名/大小宣称成功或自动覆盖重传。用户可刷新目录核对后发起新上传。
8. 临时对象在 24 小时后按数据库登记和归属清理；已解绑导致无法连接时不能保留已删除密码来清理，记录脱敏待人工清理提示。清理不能只按文件名前缀批量删除未知文件。完成操作记录保留 7 天后清理，审计保留沿用单独策略。

认证失败不自动循环尝试，防止锁 NAS 账号；只读瞬时故障最多重试一次。写入结果未知不得盲重试；取消、超时、磁盘满均关闭句柄并记录结果。

## 路径和安全边界

客户端逻辑路径使用 `/`，只在传输层解码一次；拒绝 `.`/`..` 段、反斜杠、UNC、盘符、NUL、控制字符、冒号/ADS、分隔符伪装；单文件名拒绝 Windows 不兼容字符及尾随点/空格，大小写冲突以 NAS 响应为准。不改变 NAS 原文件名大小写或静默 Unicode 归一化；无法安全表示的既有名称可列出但标记不支持操作。

不允许客户端输入原始 SMB URL。拒绝 reparse point、符号链接和 DFS referral；仅做字符串前缀检查不充分。NAS 必须将 share 作为访问边界，禁止越界链接/wide links；实际遍历还要依赖适配器不跟随链接和 NAS ACL。无法验证的 NAS 配置不能声明满足用户隔离。

威胁与控制：用户 IDOR → 服务器派生身份与所有权校验；凭据窃取 → HTTPS/认证加密/脱敏；SSRF → env 固定目标且禁用 referral；目录穿越 → 路径策略/句柄语义/NAS ACL；资源耗尽 → 并发/速率/目录数量/字节上限；存储型 XSS → 名称作为文本渲染，下载强制附件。

绑定管理为高权限行为，能够替用户替换 NAS 身份，必须单独授权并审计；管理员不能读回既有 SMB 密码。默认不强制 NAS 账号跨 Cove 用户唯一，因为域别名等不能可靠用字符串判断；绑定同一 NAS 身份会共享同一 home，UI 必须提示这种后果，推荐一人一账号。

禁用/解绑/换绑/删用户事件立即撤销票据、关闭连接、取消操作；长流每最多 5 秒复查用户、权限和版本。已发送字节或已提交 NAS 写入不能撤销。Cove 密码重置导致 authVersion 变化时同样撤销旧会话传输。

## 配置与 Docker

建议配置示例，仅属于方案；不修改真实 `.env`：

```dotenv
SMB_ENABLED=false
SMB_HOST=nas.lan
SMB_PORT=445
SMB_SHARE=home
SMB_DOMAIN=
SMB_ENCRYPTION_REQUIRED=true
SMB_CREDENTIAL_KEY_ID=v1
SMB_CREDENTIAL_KEY=
SMB_CONNECT_TIMEOUT_MS=10000
SMB_IO_IDLE_TIMEOUT_MS=60000
FILES_MAX_UPLOAD_BYTES=10737418240
FILES_MAX_ACTIVE_PER_USER=2
FILES_MAX_ACTIVE_GLOBAL=8
FILES_MAX_QUEUED_PER_USER=100
FILES_MAX_DIRECTORY_ENTRIES=50000
FILES_DIRECTORY_TIMEOUT_MS=30000
```

`SMB_CREDENTIAL_KEY` 为随机 32 字节密钥的 base64；可选 `SMB_CREDENTIAL_PREVIOUS_KEYS` 为轮换期旧 keyId→base64 的 JSON secret，轮换完成移除。开启但缺配置/密钥格式非法应启动失败；关闭时不强制要求密钥，不探测 NAS。NAS 离线不阻止身份管理启动，通过 Files 状态反馈。

安全策略为要求 SMB3 加密；显式关闭加密要求时仍要求 SMB2.1+ 和签名，不能静默回退。协议协商必须由选定适配器证实支持。

在 `apps/server/.env.example` 增加示例；Compose 仅 server 服务白名单注入以上配置，不注入 web/mysql/migrate/bootstrap-admin，不给容器特权，不发布 445。Server 容器必须能访问 NAS 的 445；`localhost` 指容器自身。修改 env 后 recreate Server，不能仅用 restart 期望重新注入变量。

Web 代理应针对传输路由关闭请求/响应缓冲，允许流式请求，body 上限与 FILES_MAX_UPLOAD_BYTES 协调，读写 idle timeout 至少 120 秒；Server 对真实字节独立执行上限，不能只相信 Content-Length。配置没有活动字节的 idle timeout，不用固定 60 秒总时长截断大文件。部署 HTTPS 由现有反向代理负责。

目录服务可在上限内完整枚举元数据、排序/筛选后分页；50,000 项为初始硬上限，不宣称无限目录能力。快照缓存按用户与全局字节预算淘汰，万级目录验证后确定预算。超过上限明确返回 DIRECTORY_TOO_LARGE，不对部分结果伪装全量排序/搜索。前端列表虚拟化，树按需展开。

## 错误、可观测性与迁移

稳定错误格式 `{code, message, retryable, requestId}`；400 非法路径，401 仅 Cove 会话失效，403 平台/NAS 拒绝，404 路径不存在，409 绑定需要修复/名称冲突，413 超限，429 额度，502 NAS 协议错误，503 未启用/离线，504 超时。NAS 密码失效使用 `SMB_CREDENTIALS_INVALID` 与 409，避免当前 API helper 因 401 清掉 Cove 登录。

审计记录 actor、动作、目标 user/operation ID、结果码、字节数与耗时；不记录正文、password、ciphertext、cookie、认证 header、原始 SMB 异常或完整文件路径。目录普通读取可用脱敏指标，拒绝单独审计。下载完成/断开分别记录，上传创建与提交分别可追踪。

数据库新增表属于增量迁移，既有用户默认未绑定；先在空库和已有库验证 migrate 与 seed 幂等。回滚先关闭 Files、停止新传输、处理未完成任务，保留新增表后退回兼容旧应用；应用回滚不还原 NAS 文件。密钥与加密数据一起验证恢复，回滚版本不能丢弃仍需解密的旧 keyId。

完成后更新产品定义、架构、身份行为、新建 `docs/behavior/files.md` 与 Docker 文档，再将 Spec 标为 Completed。本轮仅创建方案，不提前将计划写入长期事实。

## 后续演进

下一期可单独设计跨目录移动、递归删除及应用级回收策略，再增加目录上传、ZIP 下载、预览、分享和分块续传。增加覆盖或递归删除前必须明确 NAS 快照/回收机制与误操作恢复。

## 2026-09-13 实施决策

维护者批准实施。目标为威联通 NAS 的身份映射 `home`。已验证 SMB 3.1.1 登录与根目录读取，NAS 未声明加密支持；本机显式配置签名模式，产品默认仍要求加密。采用固定 smbprotocol 1.16.1 的 Python 低层协议 adapter，通过独立进程的匿名管道传递凭据/数据，禁用 DFS 自动跳转。每操作独立连接以避免跨身份缓存（替代连接池）；全局并发有界。保持祖先目录句柄且不共享删除权限，拒绝 reparse point。临时文件使用 FileInternalInformation 身份与同句柄原子不覆盖 rename。现有内置 administrator 角色自动包含未来权限，保留该既有行为；普通自定义角色不自动获得 Files 权限。

最终实现补充：SMB 进程全局有界，元数据每用户最多 4 个请求；原生 Windows 协议进程未验收，Windows 开发可用 WSL/Docker。绑定版本使用随机 UUID；恢复按过期租约处理，当前活跃传输不会被重启/恢复扫描误判。共享 Modal 补充 Tab 焦点约束以满足 Files 键盘操作。保留 Node 请求头超时、对请求设置空闲超时，文件流不受固定总时长限制。
