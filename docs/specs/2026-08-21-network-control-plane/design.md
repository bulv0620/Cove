# 统一网络控制面：技术设计

> 本文对应 [`spec.md`](spec.md)。当前状态为 Draft，设计用于关闭开放问题，不代表代码已经实现。

## 设计摘要

Home Ops Server 保持模块化单体，但 Network 领域内部拆分 API、协调器和外部 adapter。MySQL 保存 Desired/Applied/Observed 状态与 operation；生产 Compose 中 `frpc` 和 Caddy 是独立 sibling container，不内嵌进 NestJS 进程。公网 `frps` 由 Server 通过受限 SSH bootstrap 部署为 `systemd` 服务。

```text
Browser
   │ /api/network
   ▼
Home Ops Server ────────────── MySQL
   │                             │
   ├─ Network API                └─ desired/applied/observed/operations
   ├─ Reconciler worker
   ├─ Secret provider
   └─ Adapters
       ├─ Cloudflare HTTPS API
       ├─ Caddy Admin API ───── Caddy container ──► app containers
       ├─ frpc Admin API ────── frpc container ───► public frps
       └─ SSH bootstrap ──────────────────────────► public Linux host
```

## 为什么使用 sibling container

- `frpc`、Caddy 与 NestJS 有独立发布节奏和故障域。
- Server 重启不应切断已有隧道或 HTTPS 流量。
- Docker restart policy 可以独立恢复数据面。
- Server 不需要在应用进程内管理长期子进程，也不需要宿主机 PID 权限。
- 配置和管理接口可限制在 Compose 私有网络中。

不采用“Server 容器直接控制 Docker socket”作为第一版方案。Docker socket 等价于高权限宿主机控制面，会显著扩大攻击面。Server 只调用 `frpc`/Caddy 自身受限管理接口；容器的创建和升级由 Compose/release 流程负责。

## 组件边界

### Server 模块

建议目录：

```text
apps/server/src/modules/network/
  network.module.ts
  api/
    network-overview.controller.ts
    providers.controller.ts
    public-endpoints.controller.ts
    port-mappings.controller.ts
    operations.controller.ts
    dto/
  application/
    provider.service.ts
    public-endpoint.service.ts
    port-mapping.service.ts
    operation.service.ts
    reconciliation.service.ts
  domain/
    network.types.ts
    network.errors.ts
    reconciliation-plan.ts
  adapters/
    cloudflare/
    caddy/
    frp/
    ssh/
    secrets/
    mock/
  worker/
    operation-worker.service.ts
    observation-worker.service.ts
```

API Service 只改变 Desired 状态并创建 operation。Worker 获取租约后执行 adapter。Adapter 不直接决定业务顺序，也不写 HTTP response。

### Web 模块

```text
apps/web/src/features/network/
  api.ts
  types.ts
  query-keys.ts
  components/
apps/web/src/pages/network/
  network-layout.tsx
  overview-page.tsx
  public-endpoints-page.tsx
  port-mappings-page.tsx
  dns-page.tsx
  settings-page.tsx
  operations-page.tsx
```

所有子页面使用稳定 URL。TanStack Query 负责 server state；表单草稿保留在页面/表单状态中。状态标签必须同时使用文本/图标和颜色。

## 生产部署拓扑

```text
home-ops-net (Compose private network)

mysql        healthcheck
  ▲
  │
server       writes desired state; runs workers
  ├────────► frpc:7400 (private admin API)
  └────────► caddy:2019 (private admin API)

frpc ─────── outbound connection ──────► public-host:7000/frps
                                          public-host:443
                                                │ TCP tunnel
                                                ▼
caddy:443 ─────────────────────────────► target app:port

web ───────► server:3000
```

Compose 使用固定镜像 digest/tag、restart policy 和 healthcheck。`depends_on` 只用来表达创建顺序；需要 readiness 的依赖使用 `condition: service_healthy`，因为 Compose 默认只等待容器 running，不等待服务 ready（[Docker 官方说明](https://docs.docker.com/compose/how-tos/startup-order/)）。

建议卷：

| 卷                  | 挂载方 | 内容                                             |
| ------------------- | ------ | ------------------------------------------------ |
| `mysql-data`        | MySQL  | 业务数据                                         |
| `caddy-data`        | Caddy  | 证书和运行数据                                   |
| `caddy-config`      | Caddy  | Caddy 持久化配置                                 |
| `frpc-data`         | frpc   | Store/config 与非敏感运行数据                    |
| `network-snapshots` | Server | 已脱敏配置快照与回滚 metadata；不得放明文 secret |

## 本地开发拓扑

### 默认模式：Mock runtime

```env
NETWORK_ENABLED=true
NETWORK_RUNTIME=mock
NETWORK_MOCK_SCENARIO=healthy
```

- Web、Server 按现有 `pnpm dev` 启动。
- fake adapters 不执行网络、SSH、文件系统或进程副作用。
- `NETWORK_MOCK_SCENARIO` 支持 `healthy`、`provider-offline`、`apply-failure`、`partial-delete` 和 `stale`。
- Fake clock/seed 使 operation ID 之外的状态可重复。

### 集成模式：Compose profile

提供 opt-in `network-dev` profile，启动本地 `frps`、`frpc` 和 Caddy，使用 8443/17000 等非特权端口。Cloudflare 默认仍使用 fake adapter；只有显式设置测试 Zone 和 Token 才执行 provider contract test。

集成模式不得修改开发者已有 Caddy/FRP 配置，不占用宿主机 80/443，也不把测试 DNS 写入生产 Zone。

## 数据模型

以下是概念模型；字段名可在实现前按 Prisma 约定微调，但三类状态不可合并。

### `NetworkProvider`

| 字段              | 类型      | 说明                                                 |
| ----------------- | --------- | ---------------------------------------------------- |
| `id`              | UUID      | 主键                                                 |
| `kind`            | enum      | `CLOUDFLARE` / `FRP_SERVER` / `FRP_CLIENT` / `CADDY` |
| `name`            | string    | 展示名称                                             |
| `enabled`         | boolean   | Desired 开关                                         |
| `config`          | JSON      | 仅非敏感配置和 secret refs                           |
| `desiredRevision` | int       | 配置期望版本                                         |
| `appliedRevision` | int?      | 最近成功应用版本                                     |
| `observedStatus`  | enum      | `UNKNOWN` / `HEALTHY` / `DEGRADED` / `OFFLINE`       |
| `observedAt`      | datetime? | 最近探测时间                                         |
| `observedSummary` | JSON?     | 已脱敏状态摘要                                       |
| timestamps        | datetime  | 创建和更新时间                                       |

`kind` 是否唯一由类型决定：第一版 `CLOUDFLARE`、`FRP_CLIENT`、`CADDY` 各一个，`FRP_SERVER` 预留多节点但 UI 只允许一个 active。

### `NetworkSecret`

| 字段          | 类型     | 说明                                   |
| ------------- | -------- | -------------------------------------- |
| `id`          | UUID     | secret reference                       |
| `kind`        | enum     | Token/password/private key/FRP auth 等 |
| `ciphertext`  | bytes    | AEAD 密文                              |
| `nonce`       | bytes    | 唯一 nonce                             |
| `keyVersion`  | int      | 主密钥版本                             |
| `fingerprint` | string?  | 非敏感指纹/尾号                        |
| timestamps    | datetime | 创建、更新和最近使用时间               |

密钥应使用经过审查的 AEAD（例如 AES-256-GCM 或 XChaCha20-Poly1305）。主密钥不得与密文同库存储。具体选择需 ADR 批准。

### `PublicEndpoint`

| 字段              | 类型      | 说明                                                    |
| ----------------- | --------- | ------------------------------------------------------- |
| `id`              | UUID      | 主键                                                    |
| `hostname`        | string    | 小写 ASCII/Punycode 唯一域名                            |
| `targetHost`      | string    | 容器 DNS 名或允许的 IP/host                             |
| `targetPort`      | int       | 1–65535                                                 |
| `cloudflareMode`  | enum      | `DNS_ONLY` / `PROXIED`                                  |
| `tlsMode`         | enum      | 待开放问题关闭后固定枚举                                |
| `desiredState`    | enum      | `ENABLED` / `DISABLED` / `DELETED`                      |
| `desiredRevision` | int       | 乐观并发/协调版本                                       |
| `appliedRevision` | int?      | 最近成功版本                                            |
| `dnsRecordId`     | string?   | Cloudflare record ID                                    |
| `observedStatus`  | enum      | `PENDING` / `ONLINE` / `DEGRADED` / `OFFLINE` / `STALE` |
| `observedAt`      | datetime? | 最近端到端探测时间                                      |
| timestamps        | datetime  | 创建、更新和软删除时间                                  |

删除使用 tombstone，直到所有补偿步骤完成后再物理清理，避免丢失重试上下文。

### `PortMapping`

字段包括 `id`、`name`、`protocol`、`remotePort`、`targetHost`、`targetPort`、Desired/Applied revision、Desired/Observed status 和时间戳。

唯一约束：`(activeFrpServerId, protocol, remotePort)`。保留端口至少包括 FRP bind/admin、SSH、80、443 以及部署配置指定的控制端口。

### `NetworkOperation` 与 `NetworkOperationStep`

Operation 字段：资源类型/ID、action、status、idempotencyKey、attempt、maxAttempts、nextAttemptAt、leaseOwner、leaseExpiresAt、safeErrorCode、safeErrorMessage、createdBy 和时间戳。

Step 字段：operation ID、顺序、provider kind、action、status、attempt、startedAt、finishedAt、safe input/output summary。任何 summary 都经过 schema allow-list，而不是先记录完整响应再做字符串替换。

## 状态机

### Operation

```text
PENDING → RUNNING → SUCCEEDED
   │         ├──→ RETRY_WAIT ──→ RUNNING
   │         ├──→ FAILED
   │         └──→ INTERRUPTED ─→ PENDING (recovery)
   └─────────→ CANCELLED (尚未产生不可逆副作用时)
```

Worker 使用数据库租约领取 operation。启动时将租约过期的 `RUNNING` 标记为 `INTERRUPTED`，然后按幂等策略重排队。

### 公网入口创建/更新

```text
validate
  → render complete managed Caddy config
  → Caddy adapt/validate
  → Caddy POST /load
  → ensure shared FRP 443 tunnel
  → upsert owned Cloudflare DNS record
  → observe DNS + FRP + Caddy upstream + HTTPS
```

Caddy 的 `POST /load` 会在请求内完成加载，失败时保持旧配置，适合整份受管配置原子替换（[Caddy Admin API](https://caddyserver.com/docs/api/)）。Server 必须对同一 Caddy 实例串行化 load，避免并发覆盖。

### 公网入口禁用/删除

```text
disable/delete owned DNS record
  → load Caddy config without route
  → tombstone complete
```

如果 DNS 已删除而 Caddy 更新失败，公网不再有新流量，但内部旧 route 暂存；重试时每一步通过 provider ID/配置 revision 判断是否已完成。

## Adapter 设计

### Cloudflare

使用 API Token Bearer authentication；只申请目标 Zone 的 DNS Read/Write。官方 API 提供 DNS record list/create/update/delete，并支持 `proxied` 字段（[Cloudflare DNS Records API](https://developers.cloudflare.com/api/resources/dns/subresources/records/)）。

Owned record 使用：

- 已保存的 provider record ID；
- comment：`managed-by=home-ops endpoint=<uuid>`；
- 若账号能力允许，再附加等价 tag。

更新前同时校验 ID、hostname 和 ownership marker。遇到同名外部记录返回 `DNS_RECORD_CONFLICT`，不得覆盖。

### Caddy

- Admin API 只在 Compose 私有网络或 Unix socket 可达，不能映射到宿主公网。
- Server 生成完整 Caddy JSON 或规范 Caddyfile，先调用 `/adapt`/校验，再调用 `/load`。
- 所有受管 route 带稳定 `@id`；第一版仍整份 load，避免多请求修改产生竞态。
- Caddy 默认持久化最新配置，配合 `--resume` 可在重启后恢复；Home Ops 仍保存自己的 canonical Desired 状态并在恢复后比对。
- 观测使用 Admin API 和 `/reverse_proxy/upstreams`，再加独立 HTTPS probe。

### FRP client

优先使用 frpc 内建管理接口的动态 proxy store。当前官方文档说明启用 `webServer` 和 `store.path` 后，可以通过 Web UI/API 在运行时创建、更新和删除 proxy，并在重启后恢复（[frpc Client Management Interface](https://gofrp.org/en/docs/features/common/ui/)）。

- 管理接口只监听容器私网地址，使用随机高强度 credential。
- 共享 `https-ingress` TCP proxy 固定把公网 `:443` 转到 `caddy:443`。
- 普通端口映射使用稳定名称 `home-ops-<mapping-id>`。
- 每次变更后读取 runtime 状态确认，不把 API 200 等同于数据面在线。
- 若选定 FRP 版本的管理 API 不稳定或无版本契约，则退回“生成完整配置 + 校验 + 容器内 reload”的 adapter；该选择必须在实现前通过 spike 固化。

### SSH / frps bootstrap

第一版主路径：支持带 `systemd` 的 Linux amd64/arm64。

1. 使用 host key verification 建立 SSH。
2. 运行只读 preflight：OS、arch、磁盘、systemd、sudo、端口。
3. 下载固定 release 到临时目录并验证项目公布的 checksum。
4. 上传由 Home Ops 生成的配置和版本化安装脚本。
5. 安装到版本目录，例如 `/opt/home-ops/frp/<version>/`。
6. 原子切换 `current` symlink 和 `systemd` unit，执行 daemon-reload/restart。
7. 健康检查失败则切回上一 symlink 并重启。

远端只保留有限版本。SSH password 用于连接但不出现在命令行参数；如果用户选择“仅本次使用”，operation 完成后销毁 secret。长期自动升级需要保存 private key 或加密 credential。

## API 草案

所有 mutation 支持 `Idempotency-Key` header，返回 `202 Accepted` 和 operation resource；纯 Desired 状态数据库校验失败返回同步 4xx。

| Method           | Path                                          | 权限                  | 说明                            |
| ---------------- | --------------------------------------------- | --------------------- | ------------------------------- |
| GET              | `/api/network/overview`                       | page                  | 链路与摘要                      |
| GET              | `/api/network/providers`                      | page                  | 已脱敏 Provider 状态            |
| PUT              | `/api/network/providers/:kind`                | manage_providers      | 保存非敏感配置/替换 secret      |
| POST             | `/api/network/providers/frp-server/preflight` | manage_providers      | SSH 预检 operation              |
| POST             | `/api/network/providers/frp-server/deploy`    | deploy                | 部署/升级 operation             |
| GET/POST         | `/api/network/public-endpoints`               | page/manage_endpoints | 列表/创建                       |
| GET/PATCH/DELETE | `/api/network/public-endpoints/:id`           | page/manage_endpoints | 详情/更新/删除                  |
| POST             | `/api/network/public-endpoints/:id/reconcile` | deploy                | 手动协调                        |
| GET/POST         | `/api/network/port-mappings`                  | page/manage_mappings  | 列表/创建                       |
| PATCH/DELETE     | `/api/network/port-mappings/:id`              | manage_mappings       | 更新/删除                       |
| GET              | `/api/network/dns-records`                    | page                  | 仅列出授权 Zone 与受管/冲突记录 |
| GET              | `/api/network/operations`                     | view_operations       | 操作列表                        |
| GET              | `/api/network/operations/:id`                 | view_operations       | 步骤详情                        |
| POST             | `/api/network/operations/:id/retry`           | deploy                | 重试失败操作                    |

响应中用 `secretConfigured: boolean`、`secretFingerprint` 表示 credential 状态，不返回 encrypted blob 或 provider token。

## 并发与一致性

- Desired resource 使用 `revision` 乐观并发；PATCH 携带当前 revision，冲突返回 409。
- Provider/resource mutation 与 operation 创建在同一数据库事务中完成。
- Worker 对 `resourceType + resourceId` 获取租约；Caddy 全配置 load 额外获取全局 Caddy 锁。
- Cloudflare、FRP、Caddy 是 saga 步骤。每一步有 idempotent read-before-write 和补偿策略。
- 定期 full reconcile 修复人工改动导致的 drift；默认只报告，自动覆盖外部修改需管理员开启。

## 健康与 Observed 状态

建议 freshness：

| 对象              | 探测周期 | stale 阈值 |
| ----------------- | -------- | ---------- |
| frpc/frps/Caddy   | 30 秒    | 2 分钟     |
| Caddy upstream    | 60 秒    | 3 分钟     |
| Cloudflare record | 5 分钟   | 15 分钟    |
| 入口 HTTPS        | 60 秒    | 3 分钟     |

入口最终状态由多个证据聚合，但 UI 保留分项状态。不得仅因 DNS API 中存在记录就显示“在线”。

## 安全设计

- 默认拒绝 RFC1918/loopback 以外的 target，除非管理员显式允许自定义目标范围，降低 SSRF 风险。
- HTTP probes 使用 allow-list target，不接受任意 URL。
- SSH 地址与目标 host 分别校验，不允许 shell meta character 或 embedded option。
- Provider 错误进入 allow-list 转换层；未知响应只保存 correlation ID，不保存完整 body。
- Caddy Admin API credential、frpc Admin credential 和 secret master key 通过 Docker secret 注入。
- 所有危险操作二次确认，确认文案展示目标主机、版本和影响，不要求用户再次输入秘密。
- 审计记录 actor、动作、目标、结果和 operation ID。

## 可观测性

- 结构化日志字段：`operationId`、`resourceType`、`resourceId`、`provider`、`step`、`attempt`、`durationMs`、`result`。
- Metrics：队列深度、operation 延迟/失败率、provider 健康、reconcile drift 数量。
- UI operation detail 只显示 safe error code、行动建议和 correlation ID。
- 第一版可以不引入分布式 tracing，但日志与 operation 必须能关联。

## 迁移与发布顺序

1. 添加数据库表、权限 seed 和关闭状态的功能开关。
2. 发布 mock adapters、API 与 UI，只对开发/测试开启。
3. 完成 Secret Provider 与密钥恢复演练。
4. 发布 Caddy adapter 与本地 Compose 数据面。
5. 发布 FRP client adapter 和远程 bootstrap。
6. 发布 Cloudflare adapter。
7. 完成真实链路验收后在生产开启导航。

每一步必须向后兼容；禁用功能开关不会停止已有数据面，只停止新 mutation，并保留状态查看和回滚入口。

## 备选方案

### 每个域名使用一个 FRP HTTPS proxy

未采用。该方案把域名路由分散到 FRP，削弱 Caddy 作为统一 TLS/反向代理入口的价值。共享 TCP 443 tunnel 更符合既定产品模型。

### 将 frpc 嵌入 NestJS 进程

未采用。进程生命周期耦合会让 Server 重启切断数据面，且升级/故障隔离更差。

### Server 直接挂载 Docker socket

第一版不采用。权限过大；管理数据面应通过受限 API，容器生命周期交给部署系统。

### 仅生成配置，让用户手动执行

可作为故障恢复导出能力，但不满足统一管理、自动重试和状态观测目标。

## 待决策项

以下项目与 `spec.md` 开放问题一致，关闭后应形成 ADR 或直接更新本文：

- Secret Provider 算法、主密钥来源、备份和轮换。
- `frps` 是否首版只支持 systemd。
- Cloudflare 代理模式下的源站证书和 ACME 策略。
- Caddy Admin API 选择私有 TCP 还是 Unix socket。
- frpc 动态管理 API 的版本稳定性 spike 结果与 fallback。
- Worker 是否采用数据库租约队列。
