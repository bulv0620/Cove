# SMB 图床

图床位于 Infrastructure 导航，路由为 `/images`，与 Files 并列。它复用当前用户的 SMB 绑定，将原图存放在 home 下固定可见目录 `Image Hosting/`；MySQL 只保存可重建索引、恢复状态和公开 grant，不保存图片字节。

## 权限与默认行为

- 页面、上传、公开管理和删除分别需要 `infra.images.page`、`infra.images.upload`、`infra.images.publish`、`infra.images.delete`；NAS ACL 仍独立生效，超级管理员也必须绑定自己的 SMB 身份。
- 支持 JPEG、PNG、WebP、GIF、AVIF，默认每张最多 25 MiB；SVG、空文件、扩展名与解析结果不符、截断或无法完整解析的文件被拒绝。
- 每次打开上传弹窗，“上传后开启公开链接”都默认关闭。批量上传逐项执行并显示进度、失败和取消；正式文件名带随机后缀，原子提交且不覆盖已有文件。
- 图片网格使用 `Image Hosting/.cove-cache/thumbnails/` 中的私有 WebP 缩略图。缓存可删除、按需重建，并从原图对账中排除。

## 对账与 Files 协作

- 打开页面或刷新会递归枚举 `Image Hosting/`，以 SMB 对象身份优先关联记录。Files 新增的支持格式图片经内容验证后作为私有图片出现。
- 稳定对象在目录内重命名时保留公开状态；文件内容、长度或对象身份变化会撤销旧链接并恢复为私有，重新公开前再次解析与计算摘要。
- Files 删除原图后，下次图床对账会撤销链接并标记缺失。Files 可以正常查看和修改图床目录，Cove 不提供专有文件格式或迁移负担。

## 公开链接

- 私有图片可手动开启公开访问，得到同源 `/image/{publicId}`；ID 为 32 个随机字节的 URL-safe 编码，不包含用户名、文件名或 SMB 路径。
- 匿名读取在 grant、用户状态、绑定版本、配置指纹、对象身份、长度和修改时间均匹配时才返回原图。响应使用已验证 MIME、`nosniff`、限制性 CSP、inline disposition 与 `public, max-age=60, must-revalidate`。
- 关闭后再次开启会生成新 ID。任何 SMB 绑定保存、换绑、解绑，以及用户禁用或删除，都会永久撤销旧 ID；重新绑定后目录中的图片可重新发现，但默认私有。
- Cove 只提供当前 origin 的路由。域名、TLS、公网暴露、反向代理和 CDN 由部署环境负责；撤销不能召回访问者已经下载的副本。
- 本地开发时，Vite 只将有边界的 `/image` 与 `/image/...` 请求代理到 Server；`/images` 保留为 SPA 页面路由，直接打开或硬刷新时由 Web 入口处理。
- 公开读取使用 MySQL 中的单 IP 与全局分钟桶限制请求频率，并共享 SMB worker 进程配额。未知、撤销或状态不匹配的 ID 对外统一不可用。

## 删除与恢复

- 图床删除先撤销公开 grant，再删除已登记的 SMB 对象。失败进入 `CLEANUP_PENDING`；后台恢复只在路径和 SMB 对象身份都匹配时重试，不按文件名前缀批量删除。
- 上传中间态和对象身份持久化。服务重启后，过期 `COMMITTING` 只有在正式路径对象身份匹配时恢复成功；其他状态仅清理已登记临时对象并转为失败。
- 上传、公开切换和删除写入脱敏审计；频率桶不保存原始 IP。日志、响应和普通业务字段不得包含 SMB 密码、密文或原始协议响应。

配置与部署见[Files 配置与运行](../operations/files.md)，本次验收证据见[归档 SMB 图床 Spec](../specs/archive/2026-09-18-smb-image-hosting/tasks.md)。
