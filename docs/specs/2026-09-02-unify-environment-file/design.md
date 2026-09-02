# 技术设计

## 设计摘要

删除根目录 `.env.example`，将其中仍有效的管理员初始化变量补充到 `apps/server/.env.example`。NestJS `ConfigModule` 只加载当前 Server 包目录下的 `.env`，README 分别记录 Server 与 Web 的配置位置。

## 组件与边界

- NestJS Server：唯一 dotenv 路径为 `apps/server/.env`。
- Prisma CLI、seed、bootstrap-admin：继续通过包工作目录与 `dotenv/config` 读取同一文件。
- Vite Web：继续使用 Vite 默认的 `apps/web/.env`，不读取 Server 配置。

## 数据模型

无变更。

## API 契约

无变更。

## 状态与失败恢复

缺少 `apps/server/.env` 或必要变量时沿用现有启动/命令失败行为。回滚时可恢复根目录 fallback 与示例文件，不涉及持久化数据迁移。

## 安全与权限

Server secret 与前端可暴露的 `VITE_*` 变量保持分离。`.gitignore` 继续忽略实际 `.env` 文件，只允许提交 `.env.example`。

## 本地开发与生产部署

本次仅统一当前本地开发配置约定，不定义尚未实现的生产部署拓扑。

## 迁移与兼容性

若维护者目前只使用根目录 `.env`，需要先把 Server 变量移动到 `apps/server/.env`。已经使用 `apps/server/.env` 的环境无需迁移。

## 可观测性

无新增日志；通过定向测试验证根目录值不再进入 NestJS 配置。

## 备选方案

- 保留双路径 fallback：兼容性更高，但继续保留两个配置入口和漂移风险。
- 全部统一到根目录：需要额外改变 Prisma 和 Vite 的默认加载路径，扩大 monorepo 应用之间的 secret 暴露范围。

## 待决策项

无。
