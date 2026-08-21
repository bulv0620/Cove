---
title: Unified Network Control Plane
status: Draft
owners:
  - maintainer
created: 2026-08-21
updated: 2026-08-21
target_release: TBD
---

# 统一网络控制面

## 背景与问题

Home Ops 计划作为 NAS 上的自托管管理服务。用户希望通过一台有公网 IP 的服务器把 NAS 的 HTTPS 入口暴露到互联网，并在 Home Ops 内统一维护：

```text
访问者
  → Cloudflare DNS / 可选代理
  → 公网服务器 :443
  → FRP 隧道
  → NAS 上的 Caddy :443
  → 按域名反向代理到内部服务
```

FRP、Caddy 和 Cloudflare 分别配置会造成重复输入、状态割裂和局部成功难以恢复。用户真正管理的是“某个域名公开某个内部服务”，而不是三份互不关联的配置文件。

本 Spec 将该意图建模为**公网入口**，并保留独立 TCP/UDP 端口映射能力。Home Ops 保存期望状态，通过后台协调器驱动外部系统，并展示应用状态和实际观测状态。

## 目标

- 在一个 Network 模块内展示 Cloudflare DNS、FRP、Caddy 和 NAS 服务的完整访问链路。
- 通过 SSH 将指定版本的 `frps` 部署到用户控制的公网 Linux 主机，并管理其运行状态。
- 让 NAS 上的 `frpc` 与 Home Ops Docker 栈共同启动、自动恢复，并可由 Home Ops 更新映射。
- 让 NAS 上的 Caddy 根据公网入口声明生成并无中断重载反向代理配置。
- 使用最小权限 Cloudflare API Token 管理选定 Zone 的 DNS 记录。
- 支持域名入口和通用 TCP/UDP 端口映射，并提供一致的操作历史、错误和重试体验。
- 为本地开发提供不依赖真实公网服务器、Cloudflare 账号或 80/443 端口的模拟模式。

## 非目标

- 第一版不支持 Cloudflare 之外的 DNS provider。
- 第一版不支持 FRP 之外的穿透实现，也不实现 Cloudflare Tunnel。
- 第一版不提供任意 SSH 终端、任意命令执行或通用服务器运维能力。
- 第一版不负责创建或管理 NAS 内部应用容器；目标服务必须已存在且可从 Caddy 容器网络访问。
- 第一版不实现多公网节点高可用、流量负载均衡或跨 NAS 集群调度。
- 第一版不接管用户在 Cloudflare Zone 中与 Home Ops 无关的记录。
- 第一版不承诺自动修复公网服务器防火墙或云厂商安全组，只检测并给出操作建议。
- 本 Spec 不实现 Home Ops 整体 Docker 化之外的安装器或 NAS 应用商店包。

## 术语

| 术语     | 定义                                                                |
| -------- | ------------------------------------------------------------------- |
| 公网节点 | 运行 `frps` 且拥有公网 IP 的远程 Linux 主机                         |
| NAS 节点 | 运行 Home Ops、`frpc`、Caddy 和目标服务的本地主机                   |
| 公网入口 | 一个域名到一个 NAS 内部 HTTP(S) 服务的声明式映射                    |
| 端口映射 | 一个公网 TCP/UDP 端口到 NAS 内部 host:port 的映射                   |
| 协调     | 将 Desired 状态应用到外部系统并更新 Applied/Observed 状态的后台过程 |
| Provider | Cloudflare、FRP 或 Caddy 的受管连接与运行实例                       |

## 角色与权限

- 超级管理员拥有 Network 全部权限。
- 普通角色通过以下权限获得能力：
  - `infrastructure.network.page`：查看 Network 页面与非敏感状态。
  - `infrastructure.network.manage_endpoints`：创建、更新、启停和删除公网入口。
  - `infrastructure.network.manage_mappings`：管理通用端口映射。
  - `infrastructure.network.manage_providers`：配置 Cloudflare、FRP 和 Caddy。
  - `infrastructure.network.deploy`：执行远程部署、重载、重启和手动协调。
  - `infrastructure.network.view_operations`：查看已脱敏的操作历史。
- 任何 Network API 都必须在 Server 端鉴权；前端隐藏操作不能替代权限检查。

## 用户场景

### 场景 A：首次配置公网链路

管理员进入 Network 设置，依次完成：

1. 输入公网节点 IP/主机名、SSH 端口、登录用户和一次性提交的密码或私钥。
2. 测试 SSH 连接，检查 Linux 架构、权限和端口占用。
3. 选择固定 FRP 版本并部署 `frps`。
4. 配置本地 `frpc` 与远端 `frps` 的认证，验证隧道在线。
5. 配置 Cloudflare API Token，选择允许管理的 Zone。
6. 验证 Caddy Admin API 可用。

每一步都显示独立状态；失败后可修改对应配置并重试，不要求清空之前成功的配置。

### 场景 B：创建公网入口

管理员创建 `photos.example.com → immich:2283`，选择 Cloudflare 代理模式和 HTTPS。系统创建 operation，并按依赖顺序：

1. 校验域名属于已授权 Zone，目标 host/port 合法。
2. 更新 Caddy 期望配置。
3. 确保 FRP 的 443 隧道存在并在线。
4. 创建或更新带 Home Ops 标记的 DNS 记录。
5. 从 DNS、隧道、Caddy upstream 和 HTTPS 探测收集 Observed 状态。

页面必须区分“正在应用”“已应用但尚未验证”“在线”和“失败”。

### 场景 C：维护普通端口映射

管理员创建一个 TCP 或 UDP 映射，指定公网端口、内部 host/port 和启用状态。系统校验端口冲突，更新 `frpc`，并显示客户端与服务端观测状态。该映射不自动创建 Caddy 站点或 Cloudflare DNS 记录。

### 场景 D：系统或容器重启

Docker 栈重启后，数据库、Server、`frpc` 和 Caddy 按健康检查顺序恢复。协调器读取数据库中的 Desired 状态，不依赖浏览器在线；已应用配置保持可用，并在后台重新确认 Observed 状态。

### 场景 E：本地调试

开发者启动普通 `pnpm dev` 和数据库，将 Network runtime 设置为 `mock`。创建入口和映射时，fake adapter 产生可重复的成功/失败状态，但不会访问 Cloudflare、执行 SSH、占用公网端口或修改宿主机配置。集成测试可以通过 opt-in Compose profile 启动真实 `frps`、`frpc` 和 Caddy。

## 功能需求

### Network 总览

- `NET-FR-001`：系统必须展示 `Cloudflare DNS → 公网节点 → FRP → Caddy → NAS 服务` 的链路及各节点状态。
- `NET-FR-002`：每个状态必须包含状态值、最近观测时间和可选的非敏感说明。
- `NET-FR-003`：超过 freshness window 未更新的 Observed 状态必须显示为 `stale/unknown`。
- `NET-FR-004`：总览必须提供公网入口、端口映射、DNS、Provider 设置和操作历史的稳定路由。

### Provider 配置

- `NET-FR-010`：系统必须允许保存、替换和删除 Cloudflare API Token，但绝不能通过读取 API 返回原 Token。
- `NET-FR-011`：系统必须验证 Token，并只列出该 Token 可访问且具备 DNS 编辑权限的 Zone。
- `NET-FR-012`：系统必须让管理员显式选择 Home Ops 可管理的 Zone；不得修改其他 Zone。
- `NET-FR-013`：系统必须支持配置公网节点地址、SSH 端口、用户和认证方式，并在保存前测试连接。
- `NET-FR-014`：系统必须自动探测远端 OS、CPU 架构、`systemd`、sudo 能力和目标端口占用。
- `NET-FR-015`：系统必须使用固定、可审计的 FRP 版本和校验和部署 `frps`，禁止静默使用 `latest`。
- `NET-FR-016`：系统必须支持部署、升级、启动、停止、重启和查询 `frps`，并保留上一版本用于失败回滚。
- `NET-FR-017`：系统必须检测 NAS 上 `frpc` 与 Caddy 的运行和管理接口状态。

### 公网入口

- `NET-FR-020`：系统必须允许创建、查看、更新、启停和删除公网入口。
- `NET-FR-021`：公网入口必须包含唯一 hostname、目标 host、目标端口、DNS 代理模式、TLS 模式和期望启用状态。
- `NET-FR-022`：第一版只允许 hostname 属于已授权 Cloudflare Zone。
- `NET-FR-023`：目标 host 必须是合法 IP、`localhost` 或容器网络可解析名称；端口范围为 1–65535。
- `NET-FR-024`：启用入口时，系统必须生成确定性的 Caddy 配置并使用受保护的 Admin API 一次性加载完整受管配置。
- `NET-FR-025`：系统必须在 Caddy 配置成功后再创建或启用 DNS 记录，避免将流量导向未就绪入口。
- `NET-FR-026`：删除入口必须先删除/停用 DNS，再移除 Caddy route；任何一步失败都必须显示部分完成状态并允许重试。
- `NET-FR-027`：Home Ops 创建的 DNS 记录必须带可识别注释或 tag，并保存 provider record ID。
- `NET-FR-028`：系统不得修改同名但未被 Home Ops 接管的 DNS 记录；必须提示冲突并要求显式 adopt 或更换域名。第一版 MAY 延后 adopt，只提供冲突提示。
- `NET-FR-029`：多个入口必须复用一条公网 443 FRP 隧道，由 Caddy 按 hostname 分流。

### 端口映射

- `NET-FR-030`：系统必须支持 TCP 和 UDP 端口映射的 CRUD 与启停。
- `NET-FR-031`：映射必须包含唯一名称、协议、公网端口、目标 host/port 和期望状态。
- `NET-FR-032`：系统必须阻止同一协议下的公网端口冲突，并保留系统占用端口清单。
- `NET-FR-033`：系统必须通过 `frpc` 管理接口或受控配置更新映射，持久化后在 `frpc` 重启时恢复。
- `NET-FR-034`：每个映射必须展示 Desired、Applied 和 Observed 状态，而不是单一布尔值。

### 操作与协调

- `NET-FR-040`：所有产生外部副作用的请求必须创建持久化 operation，并尽快返回 operation ID。
- `NET-FR-041`：operation 必须记录资源、动作、状态、步骤、尝试次数、开始/结束时间和脱敏错误。
- `NET-FR-042`：同一资源的 operation 必须串行执行；重复请求使用幂等键去重。
- `NET-FR-043`：可重试失败必须使用有上限的指数退避；权限、验证或配置错误不得无限重试。
- `NET-FR-044`：管理员必须能够手动重试失败 operation 和触发全量 reconcile。
- `NET-FR-045`：Provider 配置、部署、入口和映射变更必须写入审计日志。

### 密钥与安全

- `NET-FR-050`：Cloudflare Token、SSH 密码/私钥口令、FRP token 和 Caddy Admin credential 必须通过 Secret Provider 加密保存。
- `NET-FR-051`：API、日志、operation 错误和审计 metadata 必须对秘密及常见派生值脱敏。
- `NET-FR-052`：SSH host key 首次连接必须展示 fingerprint 并由管理员确认；后续变化必须阻止连接，除非执行显式轮换。
- `NET-FR-053`：远端命令必须来自版本化受控脚本；用户输入只能作为经过验证的参数，禁止拼接任意 shell。
- `NET-FR-054`：Caddy Admin API 不得暴露到公网；生产环境应限制在 Compose 私有网络或权限受控的 Unix socket。
- `NET-FR-055`：Cloudflare Token 应只申请目标 Zone 的 `DNS Read` 与 `DNS Write` 权限。

## 非功能需求

- `NET-NFR-001`：控制面暂时不可用时，已经运行的 Caddy、`frpc` 和 `frps` 必须继续服务现有流量。
- `NET-NFR-002`：任何配置应用失败都必须保留上一份已验证配置。
- `NET-NFR-003`：API 创建/更新请求的同步部分应在 2 秒内返回；耗时外部操作异步执行。
- `NET-NFR-004`：Provider 探测和协调不得把明文秘密写入异常、trace 或 metrics。
- `NET-NFR-005`：Network 页面必须支持键盘操作、可见焦点、非颜色状态标识和 375px 无横向页面滚动；宽表可转换为卡片列表。
- `NET-NFR-006`：生产镜像、FRP 和 Caddy 版本必须固定，升级需要显式变更和回滚说明。
- `NET-NFR-007`：Mock runtime 的结果必须可通过 seed/场景参数重复，以支持稳定自动化测试。

## 验收条件

- `NET-AC-001`：在全新测试环境中，管理员可以完成 SSH host key 确认并部署固定版本 `frps`；服务重启后自动恢复且版本可见。
- `NET-AC-002`：配置有效 Cloudflare Token 后，只能选择授权 Zone；保存后 API 响应和数据库普通字段中不存在 Token 明文。
- `NET-AC-003`：创建 `photos.example.com → immich:2283` 后，DNS、443 隧道、Caddy route 和 HTTPS 探测均成功，页面展示各阶段时间和最终在线状态。
- `NET-AC-004`：Caddy 新配置故意无效后，operation 失败、旧 route 继续工作、DNS 不被提前发布。
- `NET-AC-005`：创建重复 hostname 或冲突公网端口时，请求在产生外部副作用前失败，并返回关联字段的明确错误。
- `NET-AC-006`：删除入口时模拟 DNS 删除成功、Caddy 更新失败，页面显示部分完成并可通过重试最终收敛。
- `NET-AC-007`：重启整个 NAS Compose 栈后，无需浏览器介入，`frpc`、Caddy 和协调器恢复，已配置入口重新显示为在线。
- `NET-AC-008`：在 `NETWORK_RUNTIME=mock` 下运行端到端测试，不访问公网、不执行 SSH、不占用宿主机 80/443，仍可覆盖成功、失败、重试和 stale 状态。
- `NET-AC-009`：没有 `manage_providers` 或 `deploy` 权限的用户无法通过 UI 或直接 API 修改 Provider 或触发部署。
- `NET-AC-010`：日志扫描和 API 契约测试证明敏感值不会出现在日志、错误、审计 metadata 或读取响应中。

## 发布与迁移约束

- 第一版以功能开关隐藏 Network 导航，直到数据库迁移、Secret Provider 和生产 runtime 均就绪。
- 数据库迁移必须先兼容旧 Server，再启用功能，不得要求破坏性重建数据库。
- 生产发布必须固定容器、FRP 和 Caddy 版本，并提供升级前备份与回滚步骤。
- Provider 尚未配置时，现有 Home Ops 页面和 API 必须保持可用。

## 开放问题（批准前必须关闭）

1. Secret Provider 的主密钥来自 Docker secret、环境变量还是 NAS 原生 secret store；恢复/轮换流程是什么？
2. 远端 `frps` 第一版只支持 `systemd` 二进制部署，还是同时支持 Docker？本设计暂以 `systemd` 为主路径。
3. Cloudflare 橙云模式下，TLS 采用 Full (strict) 所需的源站证书由 Caddy ACME DNS challenge、Cloudflare Origin Certificate 还是用户证书提供？
4. Home Ops Server 如何访问 Caddy Admin API：Compose 私有 TCP 网络还是共享 Unix socket？
5. 是否允许目标为宿主机 `host.docker.internal`，以及 Linux NAS 上的统一宿主机别名如何配置？
6. 后台 operation 第一版采用数据库轮询 worker，还是引入 Redis/队列？本设计建议先采用数据库租约队列。
7. 443 隧道在公网端是 FRP TCP proxy 直通 TLS，还是使用 FRP vhost HTTPS；本设计建议 TCP 直通，由 NAS Caddy 终止 TLS。

## 变更记录

| 日期       | 变更                   | 作者               |
| ---------- | ---------------------- | ------------------ |
| 2026-08-21 | 根据产品讨论创建 Draft | Codex / maintainer |
