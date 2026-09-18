# 执行与分工

## 已确认

- 维护者已批准 Cove 品牌统一，并要求取消所有改名迁移兼容。
- GitHub 仓库为 `bulv0620/Cove`。
- 本地 origin 为 `git@github.com:bulv0620/Cove.git`，访问已验证。
- Agent 负责项目文本、代码、配置、测试与文档统一及本地验证。
- 本地项目根目录由维护者后续自行改名，Agent 不移动。

## 使用与部署

- 浏览器只使用 Cove 状态，新版本需重新登录、设置偏好，不迁移旧键。
- 部署使用 COVE_VERSION 和 cove 镜像，不回退到其他版本变量。
- 真实环境文件、数据库、NAS 文件及运行中的生产服务不在本次修改范围内。
- 生产部署按 [Docker 指南](../../../operations/docker.md) 与 [NAS 手动部署指南](../../../operations/nas-manual-deployment.md) 进行；不将本地测试称为真实 NAS 验收。
- 2026-09-18 维护者验收通过，明确要求归档、提交并推送代码；生产部署不在本次操作范围。
