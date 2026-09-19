---
title: 图床开发态刷新路由修复
status: Completed
owners: []
created: 2026-09-19
updated: 2026-09-19
---

# 图床开发态刷新路由修复

## 背景与问题

本地开发由 Vite 在 `5173` 端口提供 Web，并将 `/api` 与匿名公开图片路由 `/image/{publicId}` 代理到 NestJS。当前 `/image` 代理使用前缀匹配，导致合法 SPA 页面 `/images` 在硬刷新时也被代理到 NestJS，并返回 `Cannot GET /images` 404；站内导航因不发起页面请求而表现正常。生产态 NestJS SPA fallback 已使用有边界的 `/image` 匹配，不受此问题影响。

## 目标

- 开发态硬刷新或直接打开 `/images` 时必须由 Vite 返回 SPA 入口。
- 开发态 `/image/{publicId}` 仍必须代理到 NestJS。
- 增加自动化回归覆盖，防止公开图片路由再次吞掉 `/images` 页面。

## 非目标

- 不改变图床页面、图片 API、公开链接格式或生产部署拓扑。
- 不改变其他 SPA 页面、认证或页面会话行为。

## 用户场景

### 刷新图床页面

开发者通过左侧导航进入 `/images` 后刷新浏览器，应用重新加载并根据当前 URL 恢复图床页面，而不是显示 NestJS 404 JSON。

### 访问公开图片

浏览器请求 `/image/{publicId}` 时，请求仍由 Vite 转发给 NestJS，并由既有公开图片端点处理。

## 功能需求

- `DEV-ROUTE-FR-001`：Vite 开发服务器的匿名图片代理必须只匹配 `/image` 路由边界，不得匹配 `/images` 或其他仅共享字符串前缀的 SPA 路由。
- `DEV-ROUTE-FR-002`：Vite 开发服务器必须继续将 `/image/{publicId}` 转发到 NestJS。

## 非功能需求

- `DEV-ROUTE-NFR-001`：代理边界必须由自动化测试覆盖 `/image`、`/image/{id}`、`/images` 和相似非目标路径。

## 验收条件

- `DEV-ROUTE-AC-001`：开发态请求 `/images` 且接受 HTML 时返回 Vite SPA 入口，浏览器刷新后重新显示图床页面。
- `DEV-ROUTE-AC-002`：开发态请求 `/image/{publicId}` 时仍命中 NestJS，而 `/images`、`/image-gallery` 等路径不命中该代理规则。
- `DEV-ROUTE-AC-003`：Web 测试、lint、typecheck、build 与格式检查通过。

## 开放问题

无。维护者在问题复现和根因说明后明确要求实施修复。

## 变更记录

| 日期       | 变更                                            | 作者               |
| ---------- | ----------------------------------------------- | ------------------ |
| 2026-09-19 | 创建 Spec；维护者明确要求修复，进入 In Progress | maintainer / Codex |
| 2026-09-19 | 实现、自动化与 Chrome 刷新验证通过，标记完成    | Codex              |
