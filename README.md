# RequestManager

RequestManager 是一个本地部署的用户需求管理工具。客户提交需求、Bug 和截图，开发者排期、备注、澄清并维护自己的私人笔记。应用使用 Next.js 单体架构和本地 SQLite，不依赖外部数据库或对象存储。

## Ubuntu 一键部署

在服务器进入 root Shell 后执行。脚本会从 GitHub 克隆代码、安装 Docker、构建镜像、迁移数据库，并隐藏提示输入首个开发者密码：

```bash
curl -fsSL https://raw.githubusercontent.com/raj8525/RequestManager/main/scripts/deploy-ubuntu.sh \
  | bash -s -- deploy --origin http://SERVER_IP:13001
```

部署完成后访问 `http://SERVER_IP:13001`。实际服务器示例：

```bash
curl -fsSL https://raw.githubusercontent.com/raj8525/RequestManager/main/scripts/deploy-ubuntu.sh \
  | bash -s -- deploy --origin http://47.121.188.131:13001
```

更新版本时重复执行相同命令。脚本先用旧版本创建完整备份，构建成功后才停服；迁移或健康检查失败会尝试恢复旧数据和旧镜像。

## 完整数据同步

在保存着正式 SQLite 和截图的原电脑、RequestManager 仓库目录中执行：

```bash
./scripts/deploy-ubuntu.sh sync root@SERVER_IP
```

这会使用应用备份机制同步 SQLite、截图和校验清单，并覆盖服务器的全部 RequestManager 数据。脚本显示源、目标和 Git 修订号后，必须输入 `yes`；远端覆盖前还会创建保护备份。不要直接上传运行中的 `.db`、`-wal` 或 `-shm` 文件。

服务器状态和日志：

```bash
/opt/request-manager/scripts/deploy-ubuntu.sh status
/opt/request-manager/scripts/deploy-ubuntu.sh logs
```

## 五分钟启动

要求 Node.js 24 和 npm。

```bash
npm ci
npm run db:migrate
ADMIN_USERNAME=admin \
ADMIN_DISPLAY_NAME=管理员 \
ADMIN_PASSWORD='请替换为10到128位密码' \
npm run admin:init
npm run dev
```

浏览器打开 [http://localhost:13001](http://localhost:13001)，使用刚创建的开发者账号登录。首次登录必须修改密码。随后在“项目管理”创建项目，在“账号管理”创建客户并分配项目。

`admin:init` 只创建首个启用的开发者，不会覆盖已有账号或打印密码。再次执行被拒绝是预期行为。

## 生产运行

复制 `.env.example` 为本机环境文件并修改 `APP_ORIGIN`、数据路径和 Cookie 配置。升级版本时先备份，再停止应用、执行迁移和构建：

```bash
npm run ops:backup
npm run db:migrate
npm run build
npm start
```

SQLite 只支持一个 RequestManager Node.js 进程。不要以 Serverless 或多实例方式运行，也不要让其他 SQLite 工具在应用运行时写同一数据库。

Ubuntu 生产服务器默认把代码放在 `/opt/request-manager`，把 SQLite、截图和备份持久化在 `/var/lib/request-manager`。容器删除或重建不会删除这些数据。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 本地开发服务器 |
| `npm run build` / `npm start` | 生产构建与启动 |
| `npm run db:migrate` | 显式执行数据库迁移 |
| `npm run admin:init` | 初始化首个开发者 |
| `npm run ops:backup` | 创建数据库和截图一致性备份 |
| `npm run ops:restore -- <目录> --confirm-restore --app-stopped` | 停服恢复 |
| `npm run ops:attachments:check` | 只读检查截图一致性 |
| `npm run ops:attachments:repair` | 仅删除确认的孤儿文件 |
| `npm test` | 单元、组件和 SQLite 集成测试 |
| `npm run test:e2e` | 隔离数据上的 Playwright 浏览器验收 |

## 文档

- [产品规则](docs/product.md)
- [架构](docs/architecture.md)
- [数据模型](docs/data-model.md)
- [权限矩阵](docs/permissions.md)
- [用户手册](docs/user-guide.md)
- [运维手册](docs/operations.md)
- [测试说明](docs/testing.md)
- [安全说明](docs/security.md)
- [需求追踪](docs/traceability.md)

完整批准规格和实施计划保存在 `docs/superpowers/`。
