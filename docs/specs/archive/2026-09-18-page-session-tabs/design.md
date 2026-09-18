# 技术设计

## 设计摘要

本文记录已完成的实现设计。Web 在认证工作台壳层中增加页面会话状态机、`PageSessionTabs` 和 `PageSessionWorkspace`。React Router 仍决定当前 URL 是否为已知且有权限的路由；会话层只把合法的活动路由映射为一个稳定挂载的页面实例。切换标签只改变活动 pane 和 URL，不卸载其他页面；关闭、失权或认证边界变化时才卸载对应实例。

```text
React Router + auth/permission guards
               │ 合法活动 routeId/location
               ▼
       PageSessionProvider
         ├─ open/activate/close/MRU
         ├─ PageSessionTabs（顶部标签栏）
         └─ PageSessionHost
              ├─ active pane: visible + interactive
              └─ inactive panes: mounted + hidden/inert
```

## 实施前事实与变更边界

- 当前 `navigation.tsx` 同时持有菜单元数据和静态 `ReactNode` 页面元素；`router.tsx` 为每个导航项生成路由；`DashboardLayout` 通过一个 `Outlet` 只显示当前页面。
- 当前各页面广泛使用本地 `useState`/`useRef`，Files 还在组件内维护目录滚动映射；路由切换卸载后这些状态无法恢复。
- 当前全局 QueryClient 能复用查询数据，但没有“一个 routeId 一个保持挂载的页面实例”的会话模型。
- 计划只改变 Web 应用壳层、导航注册表和必要的共享浮层行为，不改变 Server、数据库和现有 API 契约。

## 路由与会话模型

导航注册项从静态页面 `element` 调整为可创建实例的组件引用，并增加稳定 ID：

```ts
interface WorkspaceRoute {
  id: string;
  path: string;
  translationKey: string;
  icon: LucideIcon;
  pagePermission?: string;
  component: ComponentType;
}

interface PageSession {
  routeId: string;
  location: { pathname: string; search: string; hash: string };
  openedAt: number;
  lastActivatedAt: number;
}
```

- `routeId` 是会话身份；当前每个顶级路由最多一个实例。`search`/`hash` 更新保存在该会话的最近 location 中，但不会创建第二实例。
- 直接进入工作台时，以当前合法 location 初始化 provider，避免先闪现 Dashboard 再打开目标。根路由初始化为一个活动 Dashboard；非根路由初始化为 Dashboard + 目标，目标为活动项。
- 后续 `location` 变化由会话同步 hook 在浏览器绘制前完成打开/激活。只有路由注册表和权限守卫认可的 route 才能进入会话状态。
- 标签点击通过 React Router `navigate(session.location)` 激活；关闭活动标签通过 `navigate(fallback.location, { replace: true })` 回退。浏览器历史重新进入已关闭路由时按正常路由同步创建新实例。
- 标签标题不存文本快照，而是按 `translationKey` 实时翻译；图标使用注册表引用，因此语言和主题切换不影响组件 key。

## 组件与边界

### `PageSessionProvider`

- 放在已通过认证和强制改密检查的工作台边界内，持有 `sessions`、`activeRouteId` 与 MRU 顺序。
- 暴露 `openOrActivate`、`activate`、`close` 和权限收敛动作；所有动作验证 routeId 仍在可访问注册表中。
- Dashboard 与其他 session 一样可以关闭。关闭后仍有 session 时，回退按 `lastActivatedAt` 选择最近使用的合法项，不按标签视觉顺序猜测；关闭动作产生空集合时，在同一状态转换中创建全新的 Dashboard session 并将其设为活动项，避免渲染空白中间态。
- 不读写 localStorage/sessionStorage。Provider 卸载即结束所有页面会话。

### `PageSessionTabs`

- 位于现有 64px sticky header 之后，作为第二层 sticky 应用导航；使用既有语义颜色、边框、字体和 Lucide 图标。
- 使用 `role="tablist"`，标签使用 roving tabindex；活动标签提供文字/字重和底部指示等至少两种线索。关闭按钮是独立可命名控件，避免点击关闭时先激活标签。
- 标签容器单行横向滚动；左右按钮只在对应方向仍有隐藏内容时启用。活动项变化后使用 `scrollIntoView({ block: 'nearest', inline: 'nearest' })`，reduced-motion 下禁用平滑动画。
- 标题使用省略号时提供完整可访问名称和原生/项目 tooltip。滚轮、触控板、触摸和按钮都能访问溢出项，不依赖 hover。

### `PageSessionHost`

- 对每个 session 用稳定 `routeId` key 渲染一次注册的页面组件；激活只切换 pane 可见性，不替换 key 或重建组件。
- pane 使用正确的 `role="tabpanel"` 和 `aria-labelledby`。非活动 pane 使用 `hidden`、`aria-hidden` 和可用时的 `inert` 隔离布局、焦点与辅助技术；实现需提供浏览器兼容的焦点保护，不能只依赖 CSS `visibility`。
- 当前活动 pane 保留既有 main 样式差异：Files 使用全高无外层滚动，其余页面使用最大宽度和响应式 padding。pane 自身负责填满 host，避免同时挂载多个 Files 造成布局叠加。
- 切换后不强制把焦点送到后台 pane。由标签键盘操作激活时焦点留在活动 tab；由侧栏或直接应用导航激活时，按既有路由焦点策略把主内容设为可达目标。

### Portal 与活动状态

当前共享 `Modal` 通过 `createPortal(document.body)` 渲染，单纯隐藏父 pane 不能隐藏 portal，并可能让后台 modal 继续锁定 body 或捕获 Tab/Escape。新增只读 `PageSessionActivityContext`：

- 每个 pane 向子树提供 `active`；工作台外默认 `active = true`，避免影响登录和强制改密页。
- `Modal` 在 `open && active` 时才创建 portal 和副作用；会话失活不调用业务 `onClose`，因此父页面的 `open` 状态仍保留，返回标签可恢复 modal。
- 实施时审计所有 `createPortal`、document/window 键盘监听和 body scroll lock。页面级监听只在 active 时响应；真正的全局能力（例如上传 TransferProvider）继续位于会话边界外运行。

## 状态与释放语义

| 事件                        | 页面组件实例       | 页面本地状态 | 共享 Query 数据                         | URL/回退                               |
| --------------------------- | ------------------ | ------------ | --------------------------------------- | -------------------------------------- |
| 切换到另一标签              | 保持挂载           | 保留         | 遵循既有新鲜度与失效规则                | push/历史导航到目标                    |
| 关闭非活动标签              | 目标卸载           | 目标丢弃     | 不按页面盲目删除共享查询                | 当前 URL 不变                          |
| 关闭活动标签                | 目标卸载           | 目标丢弃     | 不撤销已完成/进行中的服务端操作         | replace 到 MRU；无剩余则新建 Dashboard |
| 权限撤销                    | 无权页面立即卸载   | 无权页面丢弃 | 清除或失效对应主体的不可访问私有查询    | 活动项失权则 replace 回退              |
| 退出、401、换用户、强制改密 | 全部工作台页面卸载 | 全部丢弃     | 清除上一认证主体的全部私有查询          | 进入认证/改密流程                      |
| 硬刷新或关闭浏览器页面      | 浏览器销毁全部实例 | 全部丢弃     | 按现有内存 QueryClient 生命周期全部丢弃 | 重新加载后由当前 URL 初始化新会话      |
| 语言/主题切换               | 保持挂载           | 保留         | 不受影响                                | URL 不变，标题/样式即时更新            |

关闭标签只释放页面实例，不直接按模糊前缀删除 React Query 数据，因为查询可能被其他已打开页面或全局 provider 共享。再次打开页面时，本地交互状态必须是新实例的默认值；如 QueryClient 中仍有未过期数据，可以先显示并按既有规则刷新。这一区分需要在测试和长期文档中明确。

## 数据获取、后台活动与传输

- 标签系统不修改现有 QueryClient 的默认 `refetchOnWindowFocus: false`、retry 或各页面 staleTime。页面保持挂载本身不得创建第二份 query observer。
- 对未来或现有定时轮询，页面可以读取 `active` 决定是否暂停纯展示刷新；不能暂停影响数据正确性或全局业务状态的任务。该选择需由页面业务测试证明。
- Files 的 `TransferProvider` 位于页面会话外，切换或关闭 Files 标签不取消已开始上传；重新打开后通过全局队列/服务端状态恢复可见信息。
- 已经发送的 mutation 不因组件卸载自动宣称取消。关闭后重新进入必须从 Server 查询事实，不能恢复已丢弃的 optimistic-only 状态。

## 认证、授权与隐私

- Session provider 的认证作用域以当前用户 ID 为 key。用户 ID 变化时先释放旧 host，再创建新 provider，禁止复用上一用户组件树。
- 退出和全局 unauthorized 处理除清 token 外，必须清除全部认证私有查询，而不只清理 Files 查询键；这防止同一浏览器后续账号观察到上一账号缓存。
- 权限变化由可访问 routeId 集合驱动收敛。前端移除标签只是体验与最小暴露措施，Server 继续对所有 API 独立授权。
- 不持久化 tabs、页面状态或表单内容，因此不新增本地敏感数据与迁移。若未来要跨刷新恢复，必须另立 Spec 定义按用户命名空间、可序列化字段白名单、版本、过期和清理策略。

## 布局与响应式

- 工作台垂直结构从 `64px header + main` 调整为 `64px header + 44px session strip + main`。两个 sticky 层必须使用明确 z-index，且移动侧栏/Modal 继续位于其上方。
- Files main 高度从 `calc(100dvh - 4rem)` 调整为扣除 header 与 session strip；其内部列表、状态栏和弹窗需重新验证。普通页面保留当前 `max-w-[1440px]` 与响应式 padding。
- 375px 下标签栏仍显示，不折行；可以压缩标签最小/最大宽度并通过横向滚动访问。页面根容器不得因此出现横向滚动。
- 使用现有 theme token，不引入独立配色；浅色与深色分别检查边框、活动指示、hover、pressed、disabled 和 focus 状态。

## API 与数据模型

无 Server API、共享契约、Prisma schema 或数据库迁移。页面会话只存在于当前 Web 内存中。

## 失败恢复与兼容性

- 若当前 URL 在注册表中但用户无权限，沿用 PermissionRoute 的安全回退，不创建 session。
- 若已打开 route 后从注册表移除或权限集合收缩，会话收敛逻辑卸载它；活动项回退到合法 MRU 或概览。
- 若浏览器不支持原生 `inert`，使用 React 属性能力与焦点/事件保护降级；不得让隐藏控件进入 Tab 顺序。
- 硬刷新自然回到当前单路由行为并创建新会话，没有本地 schema 或迁移失败面。
- Not Found、登录和强制改密保持在工作台页面会话之外。

## 验证策略

- 为 session reducer/provider 做单元测试：默认 Dashboard 初始化、去重、MRU、关闭活动/非活动、关闭 Dashboard、空集合自动重建 Dashboard、history 同步、权限收敛和认证主体切换。
- 使用组件/浏览器交互测试给页面加 mount 计数与本地输入，证明切换不 remount、关闭后重开会 remount 并重置；同时断言 routeId 始终单实例。
- 覆盖直接 URL、前进/后退、关闭后历史重进、未知路径和无权限路径。
- 覆盖 Files 目录/排序/滚动、管理页搜索/选择/Modal，以及图床筛选等代表性状态；验证 Server 数据失效仍生效。
- 覆盖 portal：后台 Modal 不可见、不锁 body、不捕获 Escape/Tab；返回后恢复。审计所有全局键盘监听。
- 在 375/768/1024/1440px 打开全部当前路由，验证标签溢出、active scroll-into-view、Files 高度、深浅主题和 reduced-motion。
- 使用键盘和辅助技术语义检查 tablist、roving tabindex、Delete、关闭按钮命名、tabpanel 关联、focus ring 和 inactive 隔离。
- 退出、401、权限撤销和换用户测试检查组件卸载、私有 Query cache 清理及无旧数据闪现。

## 备选方案

- **只把页面筛选写入 URL或 localStorage**：可恢复少量显式字段，但需要每个页面单独维护序列化协议，无法覆盖组件树、选择、弹窗和滚动现场，还会引入跨用户敏感状态清理问题。
- **只依赖 React Query 缓存**：能复用数据，不能保留组件本地交互状态，无法满足需求。
- **截图/DOM 快照式缓存**：不能安全恢复 React 状态和事件关系，且可能保存敏感内容，不采用。
- **跨刷新持久化完整会话**：需要每页定义可序列化状态、版本迁移和认证隔离，范围与风险明显更大；本轮不采用。
- **自动淘汰最旧标签**：可控制未来大量路由的内存，但违反“只有显式关闭才丢失页面现场”的核心预期；当前固定路由数量有限，不采用。

## 待决策项

无。批准本 Spec 即确认：Dashboard 是默认但可关闭的会话，关闭最后一个会话时创建全新 Dashboard；同一顶级 routeId 单实例；页面状态只在当前认证运行周期内保活；关闭不新增通用未保存确认，也不取消全局传输或已提交服务端操作。
