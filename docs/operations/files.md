# Files 配置与运行

## 本地开发

安装 Python 3.11 或更新版本；SMB 协议进程使用固定版本的 Python 依赖。macOS/Linux 在仓库根目录执行：

```sh
python3.11 -m venv apps/server/.venv
apps/server/.venv/bin/python -m pip install -r apps/server/smb/requirements.txt
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev
```

系统的 `python3` 已是 3.11+ 时可替换命令中的 `python3.11`。Windows 使用 WSL 或 Docker 运行协议进程；当前匿名管道实现的本地原生 Windows 运行未验收。已有虚拟环境无需重复创建。`db:seed` 会刷新权限并使旧登录会话失效，日常启动不需要每次 seed。

在现有 `apps/server/.env` 中补充，保留数据库/JWT 等已有值：

```dotenv
SMB_ENABLED=true
SMB_HOST=nas.lan
SMB_PORT=445
SMB_SHARE=home
SMB_DOMAIN=
SMB_ENCRYPTION_REQUIRED=true
SMB_CREDENTIAL_KEY_ID=v1
SMB_CREDENTIAL_KEY=<32-byte-random-key-in-base64>
```

使用密码管理器或 `openssl rand -base64 32` 生成独立密钥，仅保存到受保护的 env/secret 存储，不提交到仓库。不要复用 JWT_SECRET，也不要把 NAS 用户密码写到 env：每个用户通过管理界面绑定。

`SMB_ENABLED=false` 时身份管理正常运行；启用但目标或密钥配置非法时 Server 拒绝启动。NAS 暂时离线不阻止身份服务启动。

开发 Server 自动使用 `apps/server/.venv/bin/python`。其他位置可通过 `SMB_PYTHON` 指定 Python 可执行文件。SMB helper 通过独立进程管道接收凭据与文件字节，凭据不进入进程 argv 或环境变量。

## 威联通配置

启用 NAS SMB 服务和用户主目录，设置普通用户对个人 home 的权限。Files 根对应登录该账号后访问 `//NAS/home` 的虚拟个人空间。

默认要求 SMB3 加密。NAS 不支持或未开放加密时，连接失败并提示安全策略不满足。若维护者明确选择局域网签名连接，可配置：

```dotenv
SMB_ENCRYPTION_REQUIRED=false
```

此模式仍要求 SMB2.1+ 与签名、拒绝 guest/匿名身份，不会自动回退 SMB1。本轮威联通实际协商 SMB3.1.1，未声明加密能力，现有本机 env 已显式设置签名模式。

## 浏览器与代理

生产应用必须通过 HTTPS 访问，以使用 Secure 下载 cookie。只在本机 loopback HTTP 开发时设置 `FILES_ALLOW_INSECURE_LOCAL_COOKIE=true`；生产模式始终强制 Secure，不受此变量覆盖。生产镜像由 NestJS 同源提供 Web 与 API；本地开发由 Vite 代理 `/api`。

生产应用直接把浏览器文件流交给 Server，不经过镜像内反向代理。Server 以实际字节计数执行大小限制，并关闭请求总时长限制；HTTP 读写空闲超时至少 120 秒，SMB 空闲超时默认 60 秒。持续有数据的大文件不会因固定总时长被截断。外部 HTTPS 反向代理也必须关闭上传与下载缓冲，并允许所需请求大小和持续时间。

默认使用单个 Server 实例；跨实例并发配额和事件广播尚未实现，不能直接通过水平扩容宣称维持相同的全局配额。

## Docker

Cove 应用镜像已包含 `/opt/smb` Python 依赖；无需宿主机 CIFS 挂载、特权容器或 SMB 入站端口。Server 必须能够出站访问 NAS TCP 445，容器中的 localhost 不是 NAS。

Compose 从既有 `apps/server/.env` 显式注入 SMB/Files 变量到 server 服务，不向 MySQL、迁移和管理员初始化服务注入 NAS 密钥。修改 env 后需重新创建容器，例如 `docker compose --env-file apps/server/.env up -d --force-recreate server`。

镜像构建排除真实 env、虚拟环境和数据库 dump，但显式保留 Prisma SQL 迁移。单应用镜像的本机验证和延期的实际 NAS 验收记录在[归档 Spec](../specs/archive/2026-09-17-single-application-image/tasks.md)；配置交付不等于实际 NAS 路径已经通过验收。

## 密钥备份与轮换

备份加密数据库时，独立保存对应 keyId 和 env 密钥。只有数据库或只有密钥均不足以恢复绑定。密钥丢失无法恢复旧密码，需重新绑定；不能退回明文保存。

轮换时生成新密钥，设置新 `SMB_CREDENTIAL_KEY_ID`、新 `SMB_CREDENTIAL_KEY`，并临时配置 `SMB_CREDENTIAL_PREVIOUS_KEYS` 为旧 keyId→base64 密钥的 JSON 对象。Server 启动会在相同 NAS 配置下对旧 keyId 的绑定进行条件重加密。确认所有绑定已迁移并完成恢复验证后再移除旧密钥；旧数据库备份仍需其对应旧钥。缺失旧钥不会破坏身份管理，但对应绑定会提示无法解密。

应用回滚不撤销 NAS 上已经上传的文件。数据库迁移为新增表；禁用 Files、停止新传输后可保留新增表并回滚到兼容旧应用。临时文件与未知提交需先核对，不能把恢复旧数据库当作 NAS 文件回滚。

## 验证命令

```sh
pnpm --filter @cove/server test
pnpm lint
pnpm typecheck
pnpm build
```

`apps/server/test/files-live.py` 提供可选真实 NAS smoke test。用 `FILES_TEST_CONFIG` 指向仓库外、权限 600 的 JSON 文件，字段为 `baseUrl`、`adminUsername`、`adminPassword`、`smbUsername`、`smbPassword`，再用 Python 运行脚本。不要把凭据放进命令参数、测试输出或受跟踪文件。脚本创建并删除独立平台测试用户，并在成功验证上传、下载、重命名、部分删除和空目录删除后清理唯一 NAS 测试目录。
