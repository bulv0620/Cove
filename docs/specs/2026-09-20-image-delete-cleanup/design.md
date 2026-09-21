# 技术设计

## 设计摘要

将图片删除 controller 的成功响应显式设为 `204 No Content`。在 Images service 中共用同一个缩略图指纹函数，删除原图后精确查找并删除对应 WebP 缓存。

## 组件与边界

- `ImagesController`：只负责声明成功 HTTP 状态码。
- `ImagesService`：编排公开 grant 撤销、原图删除、缩略图删除、索引删除与恢复。
- SMB worker 继续使用现有 `stat` 和 `delete_object`，以路径与对象身份双重校验删除缓存文件。

## API 契约

`DELETE /api/images/:id` 成功响应从默认的 `200` 空 body 收窄为 `204 No Content`，与 Web `apiRequest<void>` 及仓库其他删除端点一致。失败码与错误 body 不变。

## 状态与失败恢复

- 先撤销 grant 并将记录设为 `REVOKED`，阻止新的预览和缩略图请求。
- 原图删除成功或已不存在后，清理由图片对象身份、修改时间和大小确定的缩略图。
- 缩略图不存在视为幂等成功；其他失败保留 `CLEANUP_PENDING`。
- 后台恢复执行相同顺序，即使原图已不存在也继续清理缩略图，全部完成后才删除索引。

## 安全与数据

缩略图路径仅由服务端指纹生成，不接受客户端路径。删除前通过 `stat` 获取对象身份，并使用 `delete_object` 防止误删同路径的替换对象。无数据库迁移。

## 验证

- controller 回归检查成功状态码声明。
- service 单元测试覆盖正常删除、缩略图精确路径、原图已不存在的恢复，以及清理失败保留待恢复状态。

## 迁移与回滚

无数据迁移。回滚 controller 状态码和 service 缩略图清理即可；回滚后会重新出现误报成功删除与缓存残留。
