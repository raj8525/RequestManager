# Ubuntu 一键部署与完整数据同步设计

**状态：** 已批准，待实施  
**日期：** 2026-07-13  
**范围：** Ubuntu 单机生产部署、GitHub 更新、SQLite 与截图完整同步

## 1. 目标

提供一个可重复执行的 Shell 入口，使没有预装 Node.js 的 Ubuntu 服务器可以从 GitHub 克隆 RequestManager、构建容器、迁移数据库并在 `13001` 端口持续运行。相同脚本还必须能从原电脑创建应用级一致性备份，将 SQLite、所有受数据库引用的截图和校验清单一起通过 SSH 上传，并在远端停服校验恢复。

完成后的标准路径是：

```bash
# 任意受支持 Ubuntu 上首次部署或更新
curl -fsSL https://raw.githubusercontent.com/raj8525/RequestManager/main/scripts/deploy-ubuntu.sh \
  | sudo bash -s -- deploy --origin http://SERVER_IP:13001

# 原电脑在仓库目录中同步完整数据
./scripts/deploy-ubuntu.sh sync ubuntu@SERVER_IP

# 服务器查看运行状态和日志
sudo /opt/request-manager/scripts/deploy-ubuntu.sh status
sudo /opt/request-manager/scripts/deploy-ubuntu.sh logs
```

脚本不得保存 GitHub Token、SSH 密码、私钥、管理员密码或会话信息。

## 2. 方案选择

采用单容器 Docker 部署，而不是在宿主机直接安装 Node.js。脚本负责在 Ubuntu 上安装 Docker Engine、克隆或更新代码、构建带固定 Git 修订号标签的镜像，并用一个带自动重启策略的容器运行应用。

选择 Docker 的原因：

- Node.js 24、原生 `better-sqlite3` 和系统库由镜像固定，不受 Ubuntu 小版本差异影响。
- SQLite 仍只由一个 RequestManager 进程访问，不引入多实例或网络数据库。
- 迁移、初始化、备份和恢复全部使用同一镜像中的项目命令，避免宿主机工具版本漂移。
- 每个 Git 修订号保留独立镜像标签，升级失败时可以使用旧镜像和升级前备份恢复。

不引入 Docker Compose、Nginx、TLS 证书自动签发、远程对象存储或持续双向复制。它们会增加部署面和运维复杂度，不是本次“一台 Ubuntu、一套本地数据”的必要条件。

## 3. 文件与运行布局

新增或修改：

- `scripts/deploy-ubuntu.sh`：唯一用户入口，兼容 Bash；`deploy` 仅在 Ubuntu 上执行，`sync` 可在 macOS 或 Linux 原电脑执行。
- `Dockerfile`：基于官方 Node.js 24 镜像构建 Next.js 生产版本，运行时保留项目运维命令所需依赖。
- `.dockerignore`：排除 Git 元数据、依赖、构建物、测试报告、环境文件和 `data/`，防止运行数据或密钥进入镜像。
- `tests/deployment/deploy-ubuntu.test.ts`：使用隔离目录和伪造命令验证参数、安全拒绝、命令顺序与失败处理。
- `README.md`、`docs/operations.md`、`.env.example`：记录一键部署、同步、恢复和配置方式。

服务器固定布局：

| 路径/对象 | 用途 |
| --- | --- |
| `/opt/request-manager` | Git 工作副本和部署脚本 |
| `/var/lib/request-manager` | 持久数据根目录，权限只授予容器运行用户 |
| `/var/lib/request-manager/request-manager.db` | SQLite 主库 |
| `/var/lib/request-manager/uploads` | 截图文件 |
| `/var/lib/request-manager/backups` | 服务端部署前、同步前备份 |
| `/var/lib/request-manager/incoming` | 已上传但尚未恢复的完整备份 |
| `/etc/request-manager/request-manager.env` | 非敏感运行配置，权限 `0600` |
| `request-manager` | 唯一应用容器名 |
| `request-manager:<git-sha>` | 按 Git 修订号构建的镜像 |

容器把 `/var/lib/request-manager` 绑定到 `/app/data`，设置 `DATABASE_PATH=/app/data/request-manager.db`、`UPLOADS_PATH=/app/data/uploads`、`TEMP_UPLOADS_PATH=/app/data/tmp` 和 `BACKUP_PATH=/app/data/backups`。容器对外只发布配置端口，默认 `13001:13001`，并使用 `--restart unless-stopped`。

## 4. 命令接口

### 4.1 `deploy`

`deploy` 是幂等的首次安装和升级命令。支持：

```text
deploy [--origin URL] [--port PORT] [--revision GIT_REF]
       [--repo URL] [--skip-admin] [--no-firewall]
```

- 默认仓库为 `https://github.com/raj8525/RequestManager.git`，默认修订为 `main`，默认端口为 `13001`。
- 必须由 root 执行；不是 Ubuntu、参数非法、目录是符号链接或端口超出 `1..65535` 时立即拒绝。
- 安装缺失的 Git、curl、CA 证书和 Docker Engine。已安装时不重复破坏配置。
- 仓库不存在时克隆；存在时只接受预期 Git 仓库且工作树必须干净，再 fetch 并 checkout 指定修订。
- 镜像构建成功后才触碰现有容器和数据。
- 已有服务升级前先调用当前容器的 `npm run ops:backup` 创建完整备份，再停旧容器、用新镜像执行迁移并启动新容器。
- 新数据库迁移后初始化首个开发者。交互终端隐藏读取密码；非交互执行必须通过 `REQUEST_MANAGER_ADMIN_PASSWORD` 环境变量传入，且不打印、不写入持久配置。`--skip-admin` 仅供随后立即恢复已有数据的同步流程使用。
- 如果 Ubuntu 的 UFW 已启用，默认只添加所选 TCP 端口规则；`--no-firewall` 可跳过。
- 启动后轮询本机登录页，只有返回 HTTP 成功状态才报告部署完成。

升级迁移或健康检查失败时，脚本停止新容器，使用旧镜像和刚创建的完整备份恢复旧数据，然后重启旧版本。若自动回滚也失败，脚本保留备份与错误日志、返回非零状态，并明确打印人工恢复命令，绝不把失败描述为成功。

### 4.2 `sync`

`sync` 在持有源数据的原电脑仓库中执行：

```text
sync SSH_TARGET [--ssh-port PORT] [--origin URL] [--port PORT]
```

流程：

1. 验证当前目录是干净的 RequestManager Git 工作树，读取本地 `HEAD`，并确认该提交已经存在于 `origin`，避免服务器无法取得与备份匹配的迁移代码。
2. 在独立临时备份根目录运行 `npm run ops:backup`。禁止直接复制运行中的 `.db`、`-wal` 或 `-shm` 文件。
3. 在任何远端部署、停服或覆盖动作前，打印源、目标、修订号和备份目录并要求确认。
4. 通过 SSH 让远端 `deploy --revision <HEAD> --skip-admin` 先对齐应用代码和镜像。
5. 通过 `scp` 把唯一完整备份目录上传到远端登录用户的私有暂存目录；不要求远端开放额外文件传输服务。
6. 远端特权子命令把上传目录移入 `incoming`，先创建远端当前数据的保护备份，再停止应用，并调用现有 `ops:restore --confirm-restore --app-stopped` 完整验证和原子恢复。
7. 恢复成功后重新启动容器，执行截图一致性检查并轮询登录页。成功后删除 incoming 副本；源电脑原有数据和服务不受影响。

任何上传中断、校验失败、迁移集不兼容、进程锁占用或健康检查失败都返回非零状态。恢复失败时重新启动未被改变的远端服务；恢复后健康检查失败时使用同步前保护备份恢复远端原数据。

同步方向始终是“当前电脑覆盖远端”。脚本不实现远端下载、双向合并或记录级冲突合并，并在真正停服恢复前打印源、目标和备份信息要求交互确认；自动化环境必须显式设置 `REQUEST_MANAGER_SYNC_CONFIRM=yes`。

### 4.3 `status` 与 `logs`

- `status` 显示容器状态、已部署 Git 修订、端口和本机健康检查结果，不输出环境文件内容。
- `logs` 调用 `docker logs --follow --tail 200 request-manager`，不额外加工可能影响排障的应用日志。

另有不在帮助首页突出展示的内部远端恢复子命令，只接受 `sync` 生成的受限目录名；它必须再次验证目录真实路径、所有者、普通文件类型和现有备份 manifest，不能执行调用方拼接的任意 Shell 文本。

## 5. 安全与数据完整性

- GitHub 公开仓库默认不需要 Token；私有仓库只复用管理员预先配置的 Git/SSH 凭据。脚本不接受把 Token 拼入仓库 URL 的快捷参数。
- SSH 使用系统现有 `ssh`/`scp` 和主机密钥校验，不使用 `StrictHostKeyChecking=no`，不代管密码或私钥。
- 所有变量都按独立参数传递并加引号；仓库地址、Git 修订、SSH 目标、端口和备份目录名使用白名单验证。禁止 `eval`。
- `.dockerignore` 必须阻止 `.env*`、`data/`、备份、浏览器产物和 Git 凭据进入构建上下文。
- 持久数据不放 Docker named volume，使用清晰的宿主机目录，便于管理员离线复制和检查；应用仍通过项目内在线备份 API 生成可恢复快照。
- 数据恢复继续复用现有 manifest v2 校验、SHA-256、SQLite integrity、外键检查、迁移 journal 兼容检查和原子交换逻辑，不另写不安全的 `cp database.sqlite` 恢复路径。
- `APP_ORIGIN` 由 `--origin` 明确配置。直接通过服务器 IP 和端口访问无需关闭同源保护；若以后增加 TLS 反向代理，管理员必须将它设为浏览器实际 HTTPS Origin 并按运维文档配置可信代理头。
- Docker 容器以固定非 root UID/GID 运行。宿主机仅对该身份开放数据目录写权限，应用代码和环境文件只读挂载或内置于镜像。

## 6. 测试与验收

自动化验证包括：

1. `bash -n scripts/deploy-ubuntu.sh` 验证语法。
2. Vitest 部署测试通过伪造 `git`、`docker`、`ssh`、`scp`、`curl` 等命令证明：参数拒绝、首次部署、幂等更新、备份先于停服、同步使用完整备份、远端失败返回非零、密码和 Token 不进入日志。
3. `npm test`、`npm run typecheck`、`npm run lint` 和 `npm run build` 保证脚本配套改动不破坏应用。
4. 在可用 Docker 环境执行真实镜像烟测：构建镜像、挂载隔离数据目录、迁移、初始化测试管理员、启动并访问登录页、创建完整备份、停服恢复、重启后再次访问。
5. 在两个隔离数据目录之间完成一次等价同步演练，确认 SQLite 记录和截图文件哈希一致，且恢复后 `npm run ops:attachments:check` 无缺失、孤儿、大小或哈希错误。

验收文档必须记录哪些验证在当前机器真实执行。若当前机器没有 Docker 或无法启动 Ubuntu 虚拟环境，只能声明静态/模拟测试通过，不能声称已经证明所有 Ubuntu 版本；脚本同时明确支持当前仍受 Docker Engine 官方仓库支持的 Ubuntu LTS `amd64` 和 `arm64`。

## 7. 文档对齐

README 增加最短部署和同步示例；运维手册解释目录、升级、同步覆盖方向、回滚和 TLS 反向代理注意事项；`.env.example` 保持源码运行默认值，并补充容器部署由脚本生成独立环境文件。部署脚本的 `--help`、README 和运维手册使用相同命令名、默认端口和路径。
