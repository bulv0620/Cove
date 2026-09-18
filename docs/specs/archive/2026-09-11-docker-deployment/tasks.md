# 实施任务

> Spec 状态变为 `Approved` 或 `In Progress` 前，不开始实现。

## 批准

- [x] 阅读产品、架构、身份行为、环境文件 Spec 和部署验证要求。
- [x] 形成范围、设计和可执行验收条件。
- [x] 维护者批准 Spec，并将状态改为 `Approved` 或 `In Progress`。

## 实现与验证

- [ ] 新增 Dockerfile 和 `.dockerignore`（`DOCKER-FR-001`、`DOCKER-NFR-001`、`DOCKER-NFR-002`；验证：干净构建、产物路径、镜像用户和 secret 检查）。
- [ ] 新增 Compose 与 Nginx 配置（`DOCKER-FR-002`、`DOCKER-FR-003`、`DOCKER-FR-005`；验证：配置校验、空卷启动、路由代理、健康和初始化失败路径）。
- [ ] 更新变量示例和显式初始化命令（`DOCKER-FR-004`、`DOCKER-FR-006`；验证：登录、重复初始化、现有本地配置兼容）。
- [ ] 验证重启、卷持久化、备份恢复与应用回滚（`DOCKER-AC-002`、`DOCKER-AC-004`；记录隔离环境实际结果）。
- [ ] 验证缺少必要密钥和 canary 泄露路径（`DOCKER-NFR-002`、`DOCKER-AC-003`；不得保存真实凭据或含密钥展开配置）。
- [x] 更新 README、长期架构、产品定义与发布文档（`DOCKER-FR-005`；文档链接、事实抽查和 `git diff --check`）。
- [ ] 汇总全部验收证据并标记 `Completed`（`DOCKER-AC-001` 至 `DOCKER-AC-004`）。

## 验证证据

- 2026-09-11：仅完成代码与文档事实调查、Draft 编写；未新增部署配置，未执行容器构建或部署验证。

## 实施进度与阻塞

- 维护者已批准设计，Spec 为 `In Progress`。Dockerfile、Compose、Nginx、变量示例和部署说明均已添加；上方实施任务同时包含运行验收，未全部验证的任务保持未勾选。
- 基础镜像固定为 Node 22.14.0 bookworm slim、Nginx 1.28.0 alpine、MySQL 8.4.6；pnpm 固定 9.12.2。Server 编译入口已核实为 `dist/main.js`；运行镜像保留迁移与初始化所需源码及工具。
- 2026-09-11，macOS arm64、Docker Engine 28.5.1、Compose 2.40.3：以临时随机测试变量执行 `docker compose --env-file /dev/null --profile tools config --format json`，仅在内存检查展开结果，确认端口范围、初始化依赖和管理员密码仅注入工具服务；逐项清空必需变量，`config --quiet` 均失败且错误中不含 canary 密钥。通过（`DOCKER-FR-002`、`DOCKER-FR-003`、`DOCKER-FR-006`、`DOCKER-AC-003` 的配置部分）。
- 2026-09-11：以非敏感占位 URL 执行 `pnpm --filter @cove/server build`，然后执行 `pnpm --filter @cove/web build`，均通过；确认编译入口存在。Web 保留既有的大 chunk 警告。此结果不代替 Linux 镜像构建验证。
- 2026-09-11：隔离项目 `cove-docker-check-20260911` 使用本机已有 `mysql:8.4.6`，执行 `up -d --pull never --wait --wait-timeout 150 mysql`；创建测试表并插入记录，使用部署说明中的 mysqldump 参数备份到内存，删除记录后导入恢复，确认记录一致；执行 `down` 再 `up` 后记录仍存在。MySQL 日志 canary 扫描通过。最后仅对该测试项目执行 `down -v`，已清理容器与测试卷（`DOCKER-AC-002`、`DOCKER-AC-004` 的数据库部分）。
- 2026-09-11：修改文档与 Compose 的 Prettier 格式检查、相对文档链接检查、`git diff --check` 通过。
- 阻塞：`docker compose --env-file /dev/null build server web` 在获取基础镜像认证 token 阶段失败，`auth.docker.io:443` 连接超时；宿主机 `curl` 连通性复查同样超时。尚未进入 Dockerfile 构建步骤。未修改 Docker 或宿主机网络设置。
- 待网络恢复后完成：干净镜像构建、全栈启动和代理登录、管理员幂等、API 重启、数据库/迁移失败阻断、镜像层及应用日志 canary 扫描、上一应用版本回滚。完整验收前不得标记 `Completed`。

## 归档记录

- 2026-09-11：维护者确认通过并要求归档当前交付；保留全部需求 ID、验证证据、网络阻塞及未勾选的验收任务。归档未将未执行测试改写为通过。
