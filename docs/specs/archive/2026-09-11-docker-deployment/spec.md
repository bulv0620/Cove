---
title: Docker Compose 部署
status: In Progress
owners: []
created: 2026-09-11
updated: 2026-09-11
archived: 2026-09-11
---

# Docker Compose 部署

## 背景与目标

立项时仓库只有本地开发启动方式，没有生产 Dockerfile 或 Compose。本次已添加从源码构建、在 NAS / Home Server 上运行现有 Web、NestJS API 与 MySQL 的配置和操作说明。维护者于 2026-09-11 确认通过并要求归档。

## 归档说明

本次归档记录维护者对当前交付的认可。Docker Hub 连接超时导致完整容器验收尚未完成，因此状态保留 `In Progress`，未验证任务仍保持未勾选，不将归档视为全部验收通过。已通过的检查和待验证项见 [`tasks.md`](tasks.md)，日常部署流程见 [`../../../operations/docker.md`](../../../operations/docker.md)。

## 非目标

- 自动 TLS、Docker socket 管理及自动发布流水线。
- 修改业务接口、权限规则、数据库 schema 或本地 dotenv 加载规则。
- 自动执行管理员初始化或自动回滚数据库迁移。

## 功能需求

- `DOCKER-FR-001`：必须提供 Web 和 Server 的多阶段 Dockerfile、根目录 `.dockerignore` 与 `compose.yaml`，使用 pnpm 锁文件构建现有应用。
- `DOCKER-FR-002`：Compose 必须包含 Web、Server、MySQL 8.4；Web 提供 SPA 路由回退并将 `/api` 原路径代理到 Server；默认仅发布 Web 的宿主机 8080 端口，允许配置端口。
- `DOCKER-FR-003`：MySQL 必须使用命名卷；数据库健康后才能执行迁移和 RBAC seed，初始化成功后才能启动 API。迁移或 seed 失败必须阻止 API 启动。
- `DOCKER-FR-004`：必须提供显式的一次性管理员初始化命令，沿用现有脚本；常规启动和重启不得重置账号或密码。
- `DOCKER-FR-005`：必须提供服务健康检查、长期服务重启策略，以及首次部署、更新、备份、恢复、回滚和保留数据的停止命令。
- `DOCKER-FR-006`：Server 继续以 `apps/server/.env` 为唯一仓库内 dotenv 入口；Compose 使用显式 `--env-file apps/server/.env` 读取部署变量，容器通过环境变量获得配置，不复制真实 dotenv 文件。

## 非功能需求

- `DOCKER-NFR-001`：基础镜像必须固定版本而非 `latest`；应用镜像应支持显式版本标签以便回滚，Server 以非 root 用户运行。
- `DOCKER-NFR-002`：镜像上下文必须排除真实环境文件、Git 历史、日志和本地构建产物；不得将真实密钥写入镜像层、前端产物或受跟踪配置。缺少必要部署密钥必须明确失败。

## 验收条件

- `DOCKER-AC-001`：示例变量填充后 Compose 配置校验通过；空卷环境构建和启动成功，Web、SPA 深层路由及代理登录请求可用，健康检查通过。
- `DOCKER-AC-002`：显式初始化管理员后可登录；重启及不删除卷的停止/重建后，账号、权限和数据库数据保留；重复 seed 和初始化不重置已有管理员。
- `DOCKER-AC-003`：数据库不可用或迁移失败时 API 不启动；缺少密钥时报错；使用隔离 canary 验证构建产物与运行日志不泄露密钥，不保存含密钥的展开配置。
- `DOCKER-AC-004`：使用隔离数据演练备份恢复与上一版本应用回滚，明确数据库迁移不能通过更换镜像撤销；记录环境、命令和结果。

## 开放问题

- 无。

## 变更记录

| 日期       | 变更                                         | 作者               |
| ---------- | -------------------------------------------- | ------------------ |
| 2026-09-11 | 创建 Draft，等待维护者批准                   | Codex              |
| 2026-09-11 | 维护者批准设计，开始实施                     | maintainer / Codex |
| 2026-09-11 | 维护者确认通过并要求归档；保留未完成验收记录 | maintainer / Codex |
