# RequestManager

RequestManager 是一个本地部署的用户需求管理工具。客户提交需求、Bug 和截图，开发者排期、备注、澄清并维护自己的私人笔记。应用使用 Next.js 单体架构和本地 SQLite，不依赖外部数据库或对象存储。

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

浏览器打开 [http://localhost:3000](http://localhost:3000)，使用刚创建的开发者账号登录。首次登录必须修改密码。随后在“项目管理”创建项目，在“账号管理”创建客户并分配项目。

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
