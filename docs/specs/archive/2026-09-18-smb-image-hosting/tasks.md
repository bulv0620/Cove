# 实施任务

> Spec 已完成；实现、验证证据和维护者接受的环境延期项已经记录。

## 阶段 0：批准条件

- [x] 确认公开链接必须由用户在上传时或事后手动开启（需求：`IMAGES-FR-005`、`IMAGES-FR-007`）。
- [x] 确认任何 SMB 绑定更新、用户禁用/删除后旧 ID 永久失效，重新绑定后重新发现图片且默认私有（需求：`IMAGES-FR-009`、`IMAGES-FR-010`）。
- [x] 确认首期 JPEG/PNG/WebP/GIF/AVIF、不支持 SVG、单图默认 25 MiB（需求：`IMAGES-FR-004`）。
- [x] 确认短缓存/必须重验证与不承诺召回已下载副本（需求：`IMAGES-NFR-006`）。
- [x] 确认图床目录在 Files 中可见且可正常修改，通过目录对账处理增删改（需求：`IMAGES-FR-002`、`IMAGES-FR-010`、`IMAGES-FR-012`）。
- [x] 确认 Cove 只提供同源 `/image/{publicId}`，域名、TLS、穿透与 CDN 不在范围内（需求：`IMAGES-FR-007`、`IMAGES-NFR-003`）。
- [x] 确认可见图床根目录固定为 `Image Hosting/`（需求：`IMAGES-FR-002`）。
- [x] 确认每次打开上传流程时都默认私有，不记住上次开启状态（需求：`IMAGES-FR-003`、`IMAGES-FR-005`）。
- [x] 确认缩略图缓存路径、非公开性、可重建性与清理边界（需求：`IMAGES-NFR-001`、`IMAGES-NFR-007`）。
- [x] 审查威胁模型、数据迁移、部分失败恢复与回滚方案（需求：全部）。
- [x] 所有开放问题已关闭，验收条件可执行，维护者批准实施并将 `spec.md` 转为 `In Progress`。

## 阶段 1：SMB 共享基础

- [x] 从 Files 中提取可复用的绑定上下文、路径政策、流式 SMB 操作与全局并发配额，保持现有 Files 行为不变（需求：`IMAGES-FR-012`；验证：现有 Files 单元/契约通过，真实 NAS smoke 由维护者延期）。
- [x] 增加图床保留根目录创建与防越界策略（需求：`IMAGES-FR-002`、`IMAGES-NFR-003`；验证：路径政策、链接/DFS/reparse point 拒绝沿用 Files 边界，真实 NAS 回归延期）。

## 阶段 2：数据、权限与 API

- [x] 新增可重建图片索引、公开 grant/tombstone 与恢复状态 Prisma 模型及增量迁移（需求：`IMAGES-FR-005`、`IMAGES-FR-008`、`IMAGES-FR-010`、`IMAGES-FR-011`；验证：generate、空库回放、当前开发库增量升级与回滚说明通过）。
- [x] 幂等 seed 图床资源与页面/上传/删除权限，验证管理员和自定义角色语义（需求：`IMAGES-FR-001`；验证：seed 连续执行两次与角色矩阵）。
- [x] 实现目录枚举/对账、所有者管理 API、手动公开状态、分页与越权失败路径（需求：`IMAGES-FR-001`、`IMAGES-FR-005`、`IMAGES-FR-006`、`IMAGES-FR-008`–`IMAGES-FR-010`；验证：单元/契约与动作权限矩阵通过，真实 NAS A/B smoke 延期）。

## 阶段 3：上传、发布与恢复

- [x] 实现流式上传、有界格式识别/结构校验、大小限制、哈希与原子不覆盖发布（需求：`IMAGES-FR-003`–`IMAGES-FR-005`、`IMAGES-NFR-001`；验证：五种格式、伪造/截断/尾随主动载荷和边界大小通过，并发/内存现场采样延期）。
- [x] 实现租约、取消、重启恢复、未知提交核对与只删除已登记对象的延迟清理（需求：`IMAGES-FR-011`；验证：对象身份、长度和清理单元测试通过，真实 NAS 故障注入延期）。

## 阶段 4：公开读取与删除

- [x] 实现无登录 `/image/{publicId}` 端点、流式读取、固定 MIME、安全响应头、缓存与统一对外错误（需求：`IMAGES-FR-005`、`IMAGES-FR-007`、`IMAGES-FR-009`、`IMAGES-NFR-001`–`IMAGES-NFR-003`、`IMAGES-NFR-006`；验证：路由边界、ETag、响应策略与失效实现通过，真实 NAS HTTP smoke 延期）。
- [x] 增加公开读取的可持久或跨进程可控限流，不信任未受控转发头（需求：`IMAGES-NFR-001`、`IMAGES-NFR-003`；验证：数据库频率桶、来源地址解析和单 IP 活跃读取实现/单元测试通过，真实多进程压力测试延期）。
- [x] 实现先撤销后清理的删除状态机与重试（需求：`IMAGES-FR-008`、`IMAGES-FR-010`；验证：先撤销、对象身份删除与待清理恢复测试通过，NAS 离线故障注入延期）。

## 阶段 5：Web 交互

- [x] 增加权限驱动的图床导航、路由、分页图片列表/网格、预览、空状态和错误状态（需求：`IMAGES-FR-001`、`IMAGES-FR-006`、`IMAGES-NFR-004`；验证：权限、分页和异常状态通过 lint/typecheck/build，浏览器多尺寸手工检查延期）。
- [x] 实现选择/拖放多图上传、逐项进度/取消/失败反馈、复制直链与 Markdown、删除确认和待清理状态（需求：`IMAGES-FR-003`、`IMAGES-FR-006`、`IMAGES-FR-008`、`IMAGES-NFR-004`；验证：中英文和交互实现通过构建，触屏/主题/尺寸手工检查延期）。

## 阶段 6：安全、部署与完成

- [x] 完成公开端点威胁模型与针对性测试，记录凭据、路径、公开 ID、内容嗅探与限流边界（需求：`IMAGES-NFR-002`、`IMAGES-NFR-003`、`IMAGES-NFR-005`；验证：代码/语料/响应边界通过，完整运行态 canary 故障注入由维护者延期）。
- [x] 完成 lint、typecheck、build、Server 单元/契约、Files 回归与 Docker 镜像构建（需求：全部；验证：按 `docs/quality/verification.md` 记录；真实 NAS/Docker `/image/{publicId}` 通路由维护者延期）。
- [x] 更新产品定义、roadmap、架构、图床行为、Files 边界和运行/部署文档，确保实际限制不被表述为已验证能力（需求：全部；验证：文档链接与事实抽查）。
- [x] 汇总验收证据；维护者接受当前实现及明确列出的环境延期项，将 Spec 标记为 `Completed` 并归档。

## 验收证据

### 2026-09-18 本地实现与自动化

- 环境：macOS arm64、Node workspace、Python 3.12 venv、Pillow 11.3.0、pillow-avif-plugin 1.5.2。
- `pnpm format:check`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check`：通过。Web build 仅保留仓库既有的大 chunk 警告，无构建失败。
- `pnpm --filter @cove/server test`：32 项通过；1 项既有 MySQL 登录限流集成测试因未提供其专用环境变量而跳过。新增覆盖图床扩展名/大小政策、发布前内容检查、对象身份删除恢复、数据库频率桶、动作权限与 `/image` SPA fallback 边界。
- Python 图片语料：JPEG、PNG、WebP、GIF、AVIF 均通过增量解析与容器结束边界；五种格式的截断输入和尾随 HTML/脚本载荷均被拒绝；缩略图转换语料通过。命令使用 `apps/server/.venv/bin/python`，未接触真实 SMB 凭据。
- 临时隔离 MySQL 8.0.44：从空库成功回放全部 12 个迁移；图床三张表存在。`pnpm --filter @cove/server db:seed` 连续执行两次均成功，`infra.images` 资源最终计数为 1。目标 MySQL 8.4 与既有库升级仍待部署环境验证。
- `docker build -t cove:image-hosting-verification .`：Linux arm64 应用镜像构建成功；镜像内 `/opt/smb` 可导入 Pillow 11.3.0 与 AVIF 插件。该结果验证依赖与构建，不替代容器连接 MySQL/NAS 后的 `/image/{publicId}` 通路 smoke。
- 新增 `apps/server/test/files-live.py` 图床 smoke：会验证真实 NAS 上传、匿名图片响应及安全头、绑定保存后旧链接失效、目录重新发现为私有和对象清理；本轮因 `FILES_TEST_CONFIG` 未设置而未执行。

### 维护者接受的部署阶段延期项

- 真实威联通 NAS 与目标 Docker 镜像中的完整 smoke、断网/重启/删除拒绝故障注入、内存采样及 canary 泄露扫描。
- 浏览器 375/768/1440px、深浅主题、键盘/触屏与实际多文件拖放的手工检查。
- MySQL 8.4 空库及既有生产式库升级验证。维护者于 2026-09-18 验收当前实现并接受以上项目延期；归档不表示这些环境路径已经执行。
