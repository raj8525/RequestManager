# 运维手册

## Ubuntu Docker 一键部署

支持 Docker Engine 官方仓库仍支持的 Ubuntu LTS `amd64` 和 `arm64`。服务器进入 root Shell 后运行：

```bash
curl -fsSL https://raw.githubusercontent.com/raj8525/RequestManager/main/scripts/deploy-ubuntu.sh \
  | bash -s -- deploy --origin http://SERVER_IP:13001
```

首次部署会通过 `/dev/tty` 隐藏读取首个开发者密码，不把密码写入环境文件或日志。无交互自动化可以临时提供 `REQUEST_MANAGER_ADMIN_PASSWORD`，命令结束后应立即清除。GitHub 公开仓库不需要 Token；脚本不接受带凭据的仓库 URL。

固定布局：

| 路径 | 用途 |
| --- | --- |
| `/opt/request-manager` | Git 工作副本和部署脚本 |
| `/var/lib/request-manager` | SQLite、截图、临时文件、完整备份和 incoming 数据 |
| `/etc/request-manager/request-manager.env` | 权限为 `0600` 的容器运行配置，不含密码 |
| `request-manager:<Git SHA>` | 按 Git 修订构建的镜像 |
| `request-manager` | 唯一应用容器 |

脚本默认发布 `13001`，UFW 已启用时加入对应 TCP 规则。可用 `--port` 修改端口、用 `--no-firewall` 跳过规则。`--origin` 必须是浏览器实际使用的 Origin；若以后使用 HTTPS 反向代理，应传入 HTTPS 地址，并按受控代理边界设置 `TRUST_PROXY_HEADERS`，不要关闭同源检查。

更新仍执行相同 `deploy --origin http://SERVER_IP:13001` 命令。流程严格为构建新镜像、使用旧容器在线备份、停旧容器、迁移、启动和健康检查。失败时脚本使用旧镜像与升级前备份自动回滚；自动回滚也失败时保留备份并返回非零状态。

查看状态和日志：

```bash
/opt/request-manager/scripts/deploy-ubuntu.sh status
/opt/request-manager/scripts/deploy-ubuntu.sh logs
```

## 从原电脑同步全部数据

在持有正式数据的原电脑仓库目录运行：

```bash
./scripts/deploy-ubuntu.sh sync root@SERVER_IP
```

可增加 `--ssh-port`、`--port` 和 `--origin`。SSH 使用系统主机密钥校验，不保存密码或私钥。同步先调用 `npm run ops:backup` 生成 SQLite、截图和 manifest 的一致性目录，让远端对齐同一 Git 修订，再通过 `scp` 上传。远端先备份当前数据，停服后使用 `ops:restore` 校验哈希、SQLite integrity、外键和迁移 journal，并在恢复后运行截图一致性检查与登录页健康检查。

同步方向永远是“当前电脑覆盖服务器”，不是双向合并。交互执行必须输入 `yes`；自动化必须显式设置 `REQUEST_MANAGER_SYNC_CONFIRM=yes`。上传、校验或恢复失败会返回非零；恢复后验证失败则使用同步前保护备份恢复远端数据。

## 运行约束

- 使用 Node.js 24 和一个 RequestManager 进程。
- SQLite、上传目录、临时目录和备份目录必须是彼此独立的普通路径，不能通过符号链接互相指向或互相包含。
- 不要用 Serverless、多实例或网络共享 SQLite 文件。
- 应用持有 `<数据库>.process-lock`。恢复命令使用同一锁，但外部 SQLite 工具不遵守此锁。

默认路径：

| 环境变量 | 默认值 |
| --- | --- |
| `DATABASE_PATH` | `data/request-manager.db` |
| `UPLOADS_PATH` | `data/uploads` |
| `TEMP_UPLOADS_PATH` | `data/tmp` |
| `BACKUP_PATH` | `data/backups` |
| `APP_ORIGIN` | `http://localhost:13001` |
| `SECURE_COOKIES` | `false`；HTTPS `APP_ORIGIN` 自动使用安全 Cookie，HTTP 部署可保持 `false` |
| `TRUST_PROXY_HEADERS` | `false` |

只有在受控反向代理覆盖客户端地址头时才启用 `TRUST_PROXY_HEADERS=true`。

应用可通过 `http://<服务器IP>:13001` 从局域网访问，也可通过 TLS 终止的内网穿透地址访问。请求来源必须与浏览器可见的 Host 或 `X-Forwarded-Host` 一致，其他跨站来源仍会被拒绝。

当前已将 `8.219.147.218:13001` 加入 Next.js Server Actions 的允许来源，用于该内网穿透地址与本机 Host 不一致的情况。

## 首次安装

```bash
npm ci
npm run db:migrate
ADMIN_USERNAME=admin \
ADMIN_DISPLAY_NAME=管理员 \
ADMIN_PASSWORD='请替换为10到128位密码' \
npm run admin:init
npm run build
npm start
```

迁移命令打印迁移前后版本，不在应用启动时自动执行。初始化命令只在没有启用开发者时创建账号；不会覆盖现有账号，也不会输出密码。

## 日常备份

```bash
npm run ops:backup
```

备份可在应用运行时执行。命令先 checkpoint WAL，使用 SQLite 在线备份生成快照，再只复制快照中有数据库记录的截图。每个文件计算 SHA-256，写入 manifest v2，完整校验后从 `.partial` 原子发布，并同步文件和目录元数据。

成功日志中的 `backupPath` 是备份目录。应把整个目录复制到另一块介质；不要只保存数据库文件。

## 恢复

1. 找到与当前应用迁移集匹配的完整备份目录。
2. 停止 RequestManager，确认没有直接写 SQLite 的其他工具。
3. 确认数据库旁没有活动的 `-wal` 或 `-shm` 文件。
4. 执行：

```bash
npm run ops:restore -- data/backups/<备份目录> --confirm-restore --app-stopped
```

恢复会验证 manifest 文件集合、大小、SHA-256、SQLite integrity、外键和有序迁移 journal。随后在数据路径旁暂存数据库和截图，原子交换；失败时回滚到原路径。缺少任一确认参数、应用进程锁仍被占用、备份属于不同迁移集或路径不安全时都会拒绝恢复。

恢复后重新启动应用，登录并打开一条带截图的需求做抽查。

旧 manifest v1 或不同代码版本生成的备份会被故意拒绝。需要用生成该备份的匹配代码版本恢复，再按正常升级流程迁移。

## 截图一致性

只读检查：

```bash
npm run ops:attachments:check
```

输出分类：数据库有记录但文件缺失、孤儿文件、大小错误、哈希错误。默认不修改任何内容。

仅清理孤儿文件：

```bash
npm run ops:attachments:repair
```

修复模式只删除确认的孤儿文件，不删除数据库行，也不尝试伪造缺失文件。执行前仍建议备份。

## 升级流程

```bash
npm ci
npm run ops:backup
# 停止应用
npm run db:migrate
npm run build
npm test
npm run test:e2e
npm start
```

若迁移失败，不要启动新版本；保留错误日志和备份目录。日志是结构化 JSON，不包含密码、会话令牌、私人笔记正文或截图内容。

## 灾难恢复演练

至少定期在隔离路径完成一次：迁移空库、初始化开发者、创建带截图需求、备份、修改数据、停服恢复、重启验证，再制造一个孤儿文件和一个缺失文件，证明只读检查不修改、修复仅移除孤儿。绝不能在演练中把 E2E 路径指向正式数据库或正式上传目录。
