# 客户重新打开需求与最后登录时间 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许客户带必填原因和截图重新打开本人已完成需求，同时记录客户最近一次成功登录时间并仅向管理员展示。

**Architecture:** 通过一次向前兼容 SQLite 迁移扩展澄清消息类型和客户最后登录字段。重新打开使用独立 multipart 路由、现有附件暂存机制和单个 `IMMEDIATE` 事务；登录时间与会话创建在同一事务内更新。界面复用现有需求操作区、确认式编辑弹窗、截图输入和账号管理表格。

**Tech Stack:** Next.js App Router、React、TypeScript、Drizzle ORM、better-sqlite3、Zod、Vitest、Testing Library、Playwright。

## Global Constraints

- 重新打开仅允许需求提交客户操作启用项目中的 `ACTIVE`、`COMPLETED` 需求。
- 重新打开原因必填且最多 10,000 字；支持 PNG/JPEG/WebP，最多 8 张、单张 10 MiB、合计 30 MiB。
- 成功状态变化固定为 `COMPLETED -> UNSCHEDULED`，保留完成说明和完成截图。
- 重新打开原因保存为澄清消息 `REOPEN_REASON`，普通消息为 `CONVERSATION`。
- 客户最后登录只记录成功登录，不记录历史、IP 或失败尝试；开发者登录不更新。
- 最后登录时间只通过开发者账号管理查询暴露。
- 发布前完整备份并验证远端 SQLite、受引用截图和 manifest；备份失败必须终止发布。

---

### Task 1: 数据库迁移与领域类型

**Files:**
- Create: `drizzle/0006-customer-reopen-last-login.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema.ts`
- Test: `tests/integration/ops/bootstrap.test.ts`

**Interfaces:**
- Produces: `users.lastLoginAt: Date | null`
- Produces: `clarificationMessages.messageKind: "CONVERSATION" | "REOPEN_REASON"`

- [ ] **Step 1: 写迁移失败测试**

在 bootstrap/迁移测试中断言新建数据库包含 `users.last_login_at`、`clarification_messages.message_kind`，并断言旧消息默认值为 `CONVERSATION`。

- [ ] **Step 2: 运行测试确认 RED**

Run: `rtk npm test -- tests/integration/ops/bootstrap.test.ts`

Expected: FAIL，提示列不存在。

- [ ] **Step 3: 添加迁移与 schema**

```sql
ALTER TABLE `users` ADD `last_login_at` integer;
ALTER TABLE `clarification_messages`
  ADD `message_kind` text DEFAULT 'CONVERSATION' NOT NULL
  CHECK (`message_kind` in ('CONVERSATION', 'REOPEN_REASON'));
```

在 Drizzle schema 中增加同名字段和枚举，并把 `0006` 加入 migration journal。

- [ ] **Step 4: 运行迁移测试确认 GREEN**

Run: `rtk npm test -- tests/integration/ops/bootstrap.test.ts`

Expected: PASS。

### Task 2: 客户重新打开领域服务与 API

**Files:**
- Create: `src/features/requests/reopen-service.ts`
- Create: `src/app/api/requests/[requestId]/reopen/route.ts`
- Modify: `src/features/requests/schemas.ts`
- Modify: `src/features/communication/queries.ts`
- Test: `tests/integration/requests/request-reopen.test.ts`
- Test: `tests/integration/api/request-route.test.ts`

**Interfaces:**
- Produces: `reopenRequestSchema`
- Produces: `reopenRequestWithAttachments(database, actor, input, files, paths): Promise<ActionResult<RequestViewDto>>`
- Produces: `POST /api/requests/{requestId}/reopen`
- Produces: `ClarificationMessageDto.messageKind`

- [ ] **Step 1: 写成功、权限、冲突、幂等和附件原子性失败测试**

覆盖本人完成需求成功重开、空原因、他人需求、非完成状态、停用项目、版本冲突、相同键重放、同键不同载荷、截图落库以及失败清理。

- [ ] **Step 2: 运行测试确认 RED**

Run: `rtk npm test -- tests/integration/requests/request-reopen.test.ts tests/integration/api/request-route.test.ts`

Expected: FAIL，重新打开服务和路由尚不存在。

- [ ] **Step 3: 实现 Zod 输入与事务服务**

```ts
type ReopenRequestInput = {
  requestId: number;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
};
```

服务先暂存截图，再在 `IMMEDIATE` 事务中重新校验实时客户、提交人、成员资格、项目启用、记录状态、完成状态和版本；写入 `REOPEN_REASON` 消息及附件，更新请求为 `UNSCHEDULED`、`needsCustomerReply=false`、版本加一，并写公开 `PROGRESS_CHANGED`。幂等指纹包含原因和附件元数据。

- [ ] **Step 4: 实现有界 multipart 路由**

复用 `boundedMultipartFormData`、`attachmentFiles`、CSRF、当前用户解析和统一错误状态映射。

- [ ] **Step 5: 查询返回消息类型**

把 `messageKind` 加入 `ClarificationMessageDto` 和查询映射，普通澄清保持 `CONVERSATION`。

- [ ] **Step 6: 运行聚焦测试确认 GREEN**

Run: `rtk npm test -- tests/integration/requests/request-reopen.test.ts tests/integration/api/request-route.test.ts tests/integration/communication/communication.test.ts tests/integration/communication/communication-attachments.test.ts`

Expected: PASS。

### Task 3: 重新打开交互与显示

**Files:**
- Create: `src/features/requests/components/reopen-request-dialog.tsx`
- Modify: `src/features/requests/components/request-actions.tsx`
- Modify: `src/features/communication/components/clarification-thread.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/components/request-detail.test.tsx`
- Test: `tests/components/request-list.test.tsx`

**Interfaces:**
- Consumes: `POST /api/requests/{requestId}/reopen`
- Consumes: `ClarificationMessageDto.messageKind`
- Produces: `ReopenRequestDialog`

- [ ] **Step 1: 写按钮可见性、必填原因、截图和标签失败测试**

断言只有提交客户在完成、正常、启用项目需求上看到“重新打开”；弹窗空原因不能提交；FormData 包含原因、版本、幂等键和截图；`REOPEN_REASON` 显示“客户重新打开”。

- [ ] **Step 2: 运行组件测试确认 RED**

Run: `rtk npm test -- tests/components/request-detail.test.tsx tests/components/request-list.test.tsx`

Expected: FAIL，入口和弹窗尚不存在。

- [ ] **Step 3: 实现弹窗**

使用现有 dialog 样式、`ScreenshotInput` 和 `data-screenshot-paste-target="true"`；文案为已确认设计，原因最多 10,000 字，确认按钮在空白内容或提交中禁用，成功后刷新页面。

- [ ] **Step 4: 接入操作区和澄清标签**

列表和详情共用 `RequestActions`，将重开资格纳入组件非空判断；普通消息保持“开发者提问/客户回复”，重开原因固定显示“客户重新打开”。

- [ ] **Step 5: 运行组件测试确认 GREEN**

Run: `rtk npm test -- tests/components/request-detail.test.tsx tests/components/request-list.test.tsx tests/components/screenshot-input.test.tsx`

Expected: PASS。

### Task 4: 客户最后成功登录时间

**Files:**
- Modify: `src/auth/actions.ts`
- Modify: `src/features/accounts/service.ts`
- Modify: `src/features/accounts/queries.ts`
- Modify: `src/features/accounts/components/user-manager.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/integration/auth/session.test.ts`
- Test: `tests/integration/accounts/accounts.test.ts`
- Test: `tests/components/developer-workbench.test.tsx`

**Interfaces:**
- Produces: `ManageableUserDto.lastLoginAt: Date | null`

- [ ] **Step 1: 写登录记录与失败不更新测试**

测试客户成功登录写入指定 `now`、第二次登录覆盖；密码错误、停用和限流不写；开发者成功登录不写。

- [ ] **Step 2: 运行认证测试确认 RED**

Run: `rtk npm test -- tests/integration/auth/session.test.ts`

Expected: FAIL，`lastLoginAt` 仍为空。

- [ ] **Step 3: 原子更新会话与最后登录**

成功验证后，在 `database.sqlite.transaction(...).immediate()` 内创建会话；仅客户执行：

```ts
database.db
  .update(users)
  .set({ lastLoginAt: resolved.now })
  .where(eq(users.id, user.id))
  .run();
```

事务成功后才写登录 Cookie。

- [ ] **Step 4: 写管理员查询与显示失败测试**

断言客户调用列表被拒绝；开发者列表 DTO 包含客户时间；表格显示格式化时间、“从未登录”和开发者“—”。

- [ ] **Step 5: 扩展管理员专用 DTO 和表格**

`ManagedUser` 保持账号写操作返回面不变；仅 `ManageableUserDto` 增加 `lastLoginAt`，管理查询显式选择该字段。表头及移动端 `data-label` 使用“最后登录”。

- [ ] **Step 6: 运行聚焦测试确认 GREEN**

Run: `rtk npm test -- tests/integration/auth/session.test.ts tests/integration/accounts/accounts.test.ts tests/components/developer-workbench.test.tsx`

Expected: PASS。

### Task 5: 全量验证与端到端验收

**Files:**
- Modify: `e2e/request-lifecycle.spec.ts`
- Modify: `e2e/auth.spec.ts`

- [ ] **Step 1: 增加重开和最后登录端到端场景**

客户重开完成需求并粘贴/上传截图，随后验证状态为未排期、编辑入口恢复、原因和图片可见；管理员账号页验证该客户最后登录不再是“从未登录”。

- [ ] **Step 2: 运行静态与单元/集成验证**

Run: `rtk npm run typecheck`

Run: `rtk npm run lint`

Run: `rtk npm test`

Expected: 全部 PASS。

- [ ] **Step 3: 隔离运行生产构建**

使用独立 `DATABASE_PATH`、`UPLOADS_PATH`、`TEMP_UPLOADS_PATH`、`BACKUP_PATH` 运行：

Run: `rtk npm run build`

Expected: PASS，且不触碰正在运行的本地数据库。

- [ ] **Step 4: 运行 Playwright**

Run: `rtk npm run test:e2e`

Expected: 全部 PASS。

### Task 6: 提交、推送、备份与发布

**Files:**
- Modify: `docs/superpowers/specs/2026-07-23-customer-last-login-design.md`
- Modify: `docs/superpowers/plans/2026-07-23-customer-reopen-and-last-login.md`

- [ ] **Step 1: 检查范围并提交**

Run: `rtk git diff --check`

Run: `rtk git status --short`

只暂存本轮文件，提交：

```bash
git commit -m "feat: reopen completed requests and track customer logins"
```

- [ ] **Step 2: 推送当前 main**

Run: `rtk git push origin main`

Expected: origin/main 指向本轮提交。

- [ ] **Step 3: 创建并验证远端完整备份**

在任何迁移、停服或替换前运行远端备份；验证 SQLite 文件、manifest、每个受引用截图、文件数量和哈希/完整性。任何失败立即停止发布。

- [ ] **Step 4: 代码更新发布**

使用项目既有代码更新流程部署已推送提交，禁止上传本机数据库或截图。

- [ ] **Step 5: 发布后复核**

核对运行提交、HTTP 登录、SQLite `integrity_check`、外键、迁移版本、核心表行数、附件引用完整性以及新增列；确认既有用户数据计数未异常减少。
