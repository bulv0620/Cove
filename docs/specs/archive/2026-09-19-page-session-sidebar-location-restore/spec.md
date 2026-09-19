---
title: 侧栏恢复页面会话完整地址
status: Completed
owners: []
created: 2026-09-19
updated: 2026-09-19
---

# 侧栏恢复页面会话完整地址

## 背景与问题

页面会话已经保存每个顶级路由最近一次活动的 `pathname`、`search` 和 `hash`。点击顶部页面会话标签时会恢复完整地址，但左侧导航仍固定进入注册路由的基础路径。例如 Files 当前位于 `/files?path=Image+Hosting`，切换到其他页面后再点击左侧“文件”，浏览器先进入 `/files`，随后会话同步逻辑把已保存地址覆盖为根目录。

该行为违反已归档页面会话 Spec 的 `PAGE-TABS-FR-002`、`PAGE-TABS-FR-004` 和 `PAGE-TABS-AC-002`，属于既有行为的回归修复。维护者于 2026-09-19 要求修复并自行验收；修复已完成并于同日验收通过。

## 目标

- 从左侧导航激活已经打开的页面会话时，恢复该会话保存的完整 `pathname + search + hash`。
- 保持直接地址访问、页面内链接和浏览器前进/后退的目标地址语义。
- 为 Files 的 `?path=...` 场景增加自动化回归覆盖。

## 非目标

- 不改变页面会话的单实例、关闭、MRU 或认证生命周期。
- 不跨刷新持久化会话地址。
- 不把侧栏基础路径永久重定向到最后访问目录。

## 功能需求

- `PAGE-LOCATION-FR-001`：侧栏导航到已有 routeId 时必须激活该会话保存的完整 location；若该 routeId 尚未打开，则仍从导航注册表的基础路径创建会话。
- `PAGE-LOCATION-FR-002`：只有本次侧栏发起的 push 导航可以请求恢复已有 location。直接地址访问、页面内链接、浏览器 back/forward 和 replace 导航必须按其实际目标 location 更新页面会话。
- `PAGE-LOCATION-FR-003`：恢复动作必须在绘制前完成，并用 history `replace` 替换侧栏产生的临时基础路径，避免根目录闪现和额外错误历史条目。

## 非功能需求

- `PAGE-LOCATION-NFR-001`：导航意图只保存在 React Router 当前 history entry 的内存 state 中，不写入本地持久化或发送给 Server。
- `PAGE-LOCATION-NFR-002`：实现必须继续以 React Router 为路由事实源，并通过现有 lint、typecheck、build 和 Web 测试。

## 验收条件

- `PAGE-LOCATION-AC-001`：Files 位于 `/files?path=Image+Hosting` 时，切到其他功能再点击左侧“文件”，地址和页面仍为 `Image Hosting`。
- `PAGE-LOCATION-AC-002`：关闭 Files 后点击左侧“文件”，打开全新 `/files` 根目录会话。
- `PAGE-LOCATION-AC-003`：直接访问 `/files` 或通过浏览器历史进入 `/files` 时仍显示根目录，不会被已有 `?path=...` 强制替换。
- `PAGE-LOCATION-AC-004`：从图床的“在 Files 中打开”进入 `/files?path=Image%20Hosting` 时，目标地址正常覆盖 Files 会话的旧地址。

## 开放问题

无。

## 变更记录

| 日期       | 变更                                         | 作者  |
| ---------- | -------------------------------------------- | ----- |
| 2026-09-19 | 复现侧栏覆盖 Files 查询参数的回归并开始修复  | Codex |
| 2026-09-19 | 完成实现与自动化、浏览器回归，等待维护者验收 | Codex |
| 2026-09-19 | 维护者验收通过并要求完成后续归档与提交       | Codex |
