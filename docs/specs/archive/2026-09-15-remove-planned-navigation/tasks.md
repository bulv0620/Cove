# 实施任务

- [x] 确认五个占位入口、共享侧栏实现及现有权限规则（NAV-FR-001、NAV-FR-002）；2026-09-15 静态阅读 navigation.tsx 与 dashboard-layout.tsx。
- [x] 维护者将 Spec 状态改为 Approved 或 In Progress。
- [x] 移除占位入口、空分组及对应渲染分支（NAV-FR-001）；验证 NAV-AC-001。
- [x] 验证保留页面路由、权限与键盘和移动端导航（NAV-FR-002）；验证 NAV-AC-002。
- [x] 运行 Web lint、typecheck、build 与 git diff --check（NAV-AC-003），记录结果。
- [x] 更新产品定义并将 Spec 标记为 Completed。

## 验证记录

2026-09-15：

- Web lint、typecheck、build 全部通过；Vite 提示产物 chunk 超过 500 kB，不影响构建。
- `git diff --check` 和变更文件 Prettier 检查通过。
- 使用临时 Playwright 脚本 `/tmp/home-ops-nav-check.cjs` 与本地 Vite 5181 端口，通过模拟 API 验证 375/768/1440px × 中英文 × 深浅主题共 12 种组合：仅保留五个有效链接，无占位按钮、系统分组和横向溢出。
- 每种组合通过键盘 Enter 进入用户页，移动端菜单正常收起；无权限普通用户仅显示概览。模拟身份最初缺少 roleCodes，补全测试数据后全部通过。未连接真实后端。
- 桌面中文浅色截图 `/tmp/home-ops-navigation.png` 已检查。现有路由与权限代码经 diff 核对保持原规则；产品定义已同步。

- 2026-09-15：维护者确认验收通过，按要求归档至 `docs/specs/archive/2026-09-15-remove-planned-navigation/`。
