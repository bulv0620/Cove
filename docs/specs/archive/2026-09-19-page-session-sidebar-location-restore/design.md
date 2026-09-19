# 技术设计

## 设计摘要

侧栏 `NavLink` 在 history state 中附带目标 `routeId`，作为一次性“激活已有页面会话”意图。`PageSessionWorkspace` 同时读取 React Router 的 navigation type：只有 `PUSH` 且 state 中 routeId 与当前合法路由一致时，才优先选择已有会话的完整 location。

若恢复地址与侧栏基础地址不同，工作区在 `useLayoutEffect` 中使用 `replace` 导航到保存地址并跳过本轮状态覆盖；下一轮 `REPLACE` 导航再按正常路径同步活动会话。若没有已有会话，继续使用侧栏基础地址创建会话。

## 状态决策

| 导航来源                          | 已有会话 | 结果                                    |
| --------------------------------- | -------- | --------------------------------------- |
| 侧栏 `PUSH`，state routeId 匹配   | 是       | 恢复会话保存的 pathname/search/hash     |
| 侧栏 `PUSH`，state routeId 匹配   | 否       | 使用注册表基础路径创建会话              |
| 页面内链接                        | 任意     | 使用链接的实际 location 更新会话        |
| 地址栏、刷新、浏览器 back/forward | 任意     | 使用浏览器实际 location，不应用侧栏恢复 |
| 权限拒绝或未知路由                | 任意     | 沿用现有守卫，不读取或创建非法页面会话  |

## 安全与兼容性

- history state 只包含稳定 routeId，不包含文件路径或敏感内容。
- 恢复前仍要求 routeId 位于当前用户可访问路由集合，不能绕过权限守卫。
- URL query/hash 继续由已有 `PageSessionLocation` 保存，不新增 API、数据库或持久化格式。

## 验证策略

- 为纯 location 解析逻辑覆盖“侧栏恢复”和“普通导航按请求地址执行”。
- 浏览器复现 Files 子目录 → 其他页面 → 左侧 Files，确认地址与面包屑恢复。
- 运行全仓格式、lint、typecheck、build 及 Web 测试。

## 待决策项

无。
