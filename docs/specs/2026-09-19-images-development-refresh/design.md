# 技术设计

## 设计摘要

将 Vite `server.proxy` 中公开图片路由的字符串前缀改为有边界的正则上下文，使 `/image` 和 `/image/...` 继续代理，而 `/images` 留给 Vite 的 SPA history fallback。

## 组件与边界

- 仅修改 `apps/web/vite.config.ts` 的开发服务器代理上下文。
- NestJS `/image/:publicId` controller、生产静态资源 fallback 与 React Router 不变。

## 数据模型

无数据模型变化。

## API 契约

公开 URL 仍为 `/image/{publicId}`，管理 API 仍位于 `/api`；不改变响应契约。

## 状态与失败恢复

无持久状态或迁移。回滚时恢复原代理键即可，但会重新引入 `/images` 刷新 404。

## 安全与权限

代理收窄不会扩大匿名访问范围；公开图片的鉴权和限流仍由 NestJS 处理。

## 本地开发与生产部署

修复仅影响 Vite 开发服务器。生产态继续使用 NestJS 中已有的边界正则与 SPA fallback。

## 迁移与兼容性

无需迁移。`/image/{publicId}` 与现有调用方兼容。

## 可观测性

通过 HTTP 响应来源和浏览器硬刷新验证；不新增运行时日志。

## 备选方案

- 在代理中增加 `bypass`：能够修复，但把简单的路径边界拆成额外分支，维护成本更高。
- 改名 `/images` 页面或公开图片路由：会改变稳定 URL，不符合本次最小修复范围。

## 待决策项

无。
