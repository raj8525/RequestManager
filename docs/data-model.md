# 数据模型

所有时间以 UTC 毫秒时间戳存储。业务表由 `src/db/schema.ts` 定义，显式 SQL 迁移位于 `drizzle/`。

| 表 | 关键字段 | 关键约束 |
| --- | --- | --- |
| `users` | 用户名、显示名、密码哈希、角色、启用、强制改密 | 用户名大小写不敏感唯一；角色仅客户/开发者 |
| `sessions` | 令牌摘要、用户、过期和使用时间 | 令牌摘要唯一；用户停用或改密后撤销 |
| `auth_throttle` | 规范用户名、来源摘要、窗口和计数 | 复合主键；计数非负；过期清理和总行数上界 |
| `projects` | 编号、名称、说明、启用 | 项目编号大小写不敏感唯一 |
| `project_memberships` | 客户、项目 | 复合主键；开发者不需要成员关系 |
| `requests` | 项目、提交人、正文、类型、优先级、进度、记录状态、待回复、版本 | 创建人加幂等键唯一；枚举检查；暂停必须同时为已排期 |
| `attachments` | 需求、上传人、随机存储名、原名、MIME、大小、SHA-256 | 存储名唯一；大小非负 |
| `public_remarks` | 需求、作者、正文、幂等键 | 作者加幂等键唯一；追加写入 |
| `private_notes` | 需求、开发者、正文 | 每位开发者在每条需求最多一份 |
| `clarification_messages` | 需求、作者、作者角色、正文、幂等键 | 作者加幂等键唯一；消息不可编辑或删除 |
| `request_events` | 需求、操作者、类型、可见性、结构化载荷 | 事件类型和可见性检查；私人笔记正文不写入 |
| `developer_questions` | 项目、开发者、正文、提醒状态、版本 | 创建者加幂等键唯一；三态检查 |
| `developer_question_messages` | 提问、作者、角色、正文 | 作者加幂等键唯一；追加写入 |
| `developer_question_attachments` | 提问、可选消息、文件元数据 | 存储名唯一；大小非负 |
| `developer_question_events` | 提问、操作者、事件类型 | 创建、追问、回复、已查看事件检查 |

Drizzle 使用内部表 `__drizzle_migrations` 记录有序迁移哈希和创建时间。备份 manifest 会保存这一 journal，恢复时要求 manifest、快照数据库和当前代码三方完全一致。

## 枚举

- `users.role`：`CUSTOMER`、`DEVELOPER`
- `requests.request_type`：`BUG`、`CHANGE`、`NEW_FEATURE`
- `requests.priority`：`URGENT`、`IMPORTANT`、`NORMAL`
- `requests.progress_status`：`UNSCHEDULED`、`SCHEDULED`、`COMPLETED`
- `requests.record_status`：`ACTIVE`、`PAUSED`、`ARCHIVED`
- `request_events.visibility`：`PUBLIC`、`DEVELOPER`
- `developer_questions.attention_status`：`WAITING_CUSTOMER`、`WAITING_DEVELOPER`、`SEEN`

## 删除与保留

产品不提供用户、项目或需求删除。账号和项目通过启停保留历史，需求通过暂停和归档保留历史。Schema 中的级联删除只用于数据库一致性和受控维护，不是界面能力。

## 文件与数据库关系

数据库只保存截图元数据。文件实际路径由服务端使用随机 `storage_name` 推导，原始文件名不参与路径拼接。附件检查器对比存在性、大小和 SHA-256：缺失或损坏只报告；修复模式只删除数据库中没有记录的孤儿文件，不删除缺失文件对应的数据库行。
