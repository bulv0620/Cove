# 实施任务

> 维护者已批准统一 Cove 品牌，并明确取消改名兼容。以下以最终范围为准，需求 ID 保持不变。

## 实施

- [x] 按维护者指令更新 Spec 与设计，移除迁移兼容范围（全部需求）。
- [x] 统一品牌、工程包、依赖、脚本与配置（FR-001、002）。
- [x] 浏览器仅使用 Cove 键，删除迁移逻辑并更新测试（FR-003）。
- [x] Server/Python 仅识别 Cove 临时前缀，保留登记与对象标识校验（FR-004）。
- [x] Compose 仅使用 COVE_VERSION，移除回退和专用迁移文档（FR-005）。
- [x] 保留真实环境文件、数据库、密钥和 NAS 文件；统一示例（FR-006）。
- [x] 更新长期文档与归档 Spec，明确产品规划及历史名称规范化说明（FR-007）。
- [x] origin 已更新为 `git@github.com:bulv0620/Cove.git` 并验证；本地根目录不移动（FR-008）。

## 最终验证

- [x] frozen-lockfile 安装、format、lint、typecheck、build 通过（AC-001）。
- [x] 前轮 12 组中英文/主题/尺寸与键盘导航已通过，页面品牌和布局本轮未再修改（AC-002）。
- [x] Cove 存储、用户隔离、异常、401/退出测试通过（AC-003）。
- [x] Cove 上传路径、保留前缀与登记清理测试通过（AC-004）。
- [x] Compose 指定值/默认值检查和最新镜像构建通过（AC-005）。
- [x] 所有维护的项目文本旧名称零命中，文档链接有效（AC-006、FR-009）。
- [x] diff 检查及敏感文件/数据库变更边界检查通过（AC-007）。
- [x] 同步最终验证证据并标记 Completed（全部需求）。

## 已有证据

- 2026-09-17：GitHub 改名由维护者确认，origin 更新后 `git ls-remote origin HEAD` 通过。
- 前轮 UI 验证：本地 Vite + Playwright（mock API），375/768/1440 × 中英文 × 深浅主题共 12 组，含键盘导航、移动菜单关闭和受限用户导航；Cove 截图已检查。本轮不修改布局文案。
- 前轮隔离容器验证：MySQL 8.4.6、迁移、seed、管理员初始化、首页、匿名 401、登录、重启后用户与会话保留均通过；SMB 未启用，测试容器/数据卷/网络已清理。此结果不代表真实 NAS 验收。
- 按维护者最新范围，不再要求旧状态迁移、旧部署升级或回滚验收；生产部署未操作。

## 最终范围验证（2026-09-17）

- `pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck`、`pnpm build` 全部通过；Vite 保留既有 chunk 大小提示。
- `pnpm --filter @cove/server test`：19 项通过，包含 Cove 上传临时路径、保留名称过滤及登记对象清理。
- `node --test apps/web/test/storage.test.cjs`：5 项通过，覆盖只读写 Cove 键、用户隔离、存储失败、401 与退出。
- `python3 apps/server/test/worker-prefixes.test.py`：2 项通过，覆盖 Cove 前缀大小写保护、对象标识不符和普通文件拒绝清理。
- Compose 使用占位凭据校验 COVE_VERSION 指定值与默认 local，均通过；已删除变量回退。
- 项目受跟踪及新增文本扫描 189 个文件，原品牌写法零命中；所有 Markdown 相对链接有效。扫描不包含 Git 内部、第三方依赖、真实环境文件和根目录路径。
- `pnpm format:check`、`git diff --check` 通过；Prisma schema/迁移、真实环境文件和生产部署未改动。origin 仍为 `git@github.com:bulv0620/Cove.git`。

- `docker build -t cove:rename-check .` 在最终单一命名实现上构建成功（AC-005）。全部最终范围验收完成，Spec 标记为 Completed；不包含生产发布。

## 维护者验收

2026-09-18：维护者确认验收通过，批准归档并提交、推送本次代码。归档后的相对链接与格式检查通过；本轮仅调整归档文档，沿用上述代码验证结果。
