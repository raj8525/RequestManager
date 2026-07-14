# 需求标题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为客户需求增加独立标题，并安全兼容历史无标题数据的一次性补录。

**Architecture:** SQLite 通过新增可空列保留历史数据，领域服务分别处理完整编辑和标题补录，页面根据服务端权限决定表单模式。列表、详情和搜索统一使用新标题字段。

**Tech Stack:** Next.js 16、React、TypeScript、Drizzle ORM、SQLite、Zod、Vitest、Playwright

## Global Constraints

- 标题去除首尾空白后长度为 1 到 100 个字符。
- 新建需求标题必填；历史空标题不自动生成。
- 历史补录只允许原提交客户写入一次标题，不修改其他字段。
- 停用项目中的需求保持客户只读。
- 迁移和部署不得覆盖现有数据库与截图。

---

### Task 1: 数据结构与校验契约

**Files:**
- Create: `drizzle/0004_request-title.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema.ts`
- Modify: `src/features/requests/constants.ts`
- Modify: `src/features/requests/schemas.ts`
- Test: `tests/unit/db/client.test.ts`

**Interfaces:**
- Produces: `requests.title: string | null`、`requestTitleSchema`、包含 `title` 的创建和编辑输入。

- [ ] **Step 1:** 写迁移与输入校验的失败测试，覆盖旧记录升级后 `title === null` 和空标题拒绝。
- [ ] **Step 2:** 运行定向测试并确认因列和校验缺失而失败。
- [ ] **Step 3:** 增加可空列迁移、Schema 字段和 1 到 100 字标题校验。
- [ ] **Step 4:** 运行定向测试并确认通过。

### Task 2: 领域权限与持久化

**Files:**
- Modify: `src/features/requests/policy.ts`
- Modify: `src/features/requests/service.ts`
- Modify: `src/features/requests/presenter.ts`
- Modify: `src/features/attachments/service.ts`
- Test: `tests/unit/requests/policy.test.ts`
- Test: `tests/integration/requests/request-service.test.ts`
- Test: `tests/integration/attachments/attachments.test.ts`

**Interfaces:**
- Produces: `canFillLegacyRequestTitle(actor, request)`、`fillLegacyRequestTitle(database, actor, input)`、带 `title` 的 `RequestDto`。

- [ ] **Step 1:** 写失败测试覆盖创建、普通编辑、所有历史状态补录、一次性、越权、停用项目和版本冲突。
- [ ] **Step 2:** 运行定向测试并确认失败原因是标题行为尚未实现。
- [ ] **Step 3:** 将标题加入创建指纹和完整编辑；实现独立标题补录命令及条件更新。
- [ ] **Step 4:** 运行领域和附件测试并确认通过。

### Task 3: API 与页面体验

**Files:**
- Modify: `src/app/api/requests/route.ts`
- Modify: `src/app/api/requests/[requestId]/route.ts`
- Modify: `src/app/(app)/requests/[requestId]/edit/page.tsx`
- Modify: `src/features/requests/components/request-form.tsx`
- Modify: `src/features/requests/components/request-actions.tsx`
- Modify: `src/features/requests/components/request-list.tsx`
- Modify: `src/features/requests/components/request-detail.tsx`
- Modify: `src/features/requests/queries.ts`
- Test: `tests/integration/api/request-route.test.ts`
- Test: `tests/components/request-form.test.tsx`
- Test: `tests/components/request-list.test.tsx`
- Test: `tests/components/request-detail.test.tsx`

**Interfaces:**
- Consumes: 标题字段、补录权限和服务命令。
- Produces: 新建/编辑/补录三种表单行为、标题列表与详情展示、标题搜索。

- [ ] **Step 1:** 写组件和路由失败测试，证明标题未显示、未提交或补录载荷不受限。
- [ ] **Step 2:** 运行定向测试并确认预期失败。
- [ ] **Step 3:** 实现表单模式、API 分流、列表/详情标题及搜索条件。
- [ ] **Step 4:** 运行组件、API 和查询测试并确认通过。

### Task 4: 文档、全量验证与部署

**Files:**
- Modify: `docs/product.md`
- Modify: `docs/data-model.md`
- Modify: `docs/permissions.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/traceability.md`
- Modify: `tests/e2e/request-workflow.spec.ts`

**Interfaces:**
- Produces: 与运行行为一致的产品、权限、数据和使用文档。

- [ ] **Step 1:** 增加浏览器 E2E，覆盖标题必填、列表标题和一次性历史补录。
- [ ] **Step 2:** 运行 E2E 并确认改动前失败、实现后通过。
- [ ] **Step 3:** 更新长期文档并检查设计、计划与代码一致。
- [ ] **Step 4:** 运行测试、lint、类型检查、生产构建和审计。
- [ ] **Step 5:** 检查差异，只暂存本迭代文件，提交并推送 `main`。
- [ ] **Step 6:** 执行代码更新部署，验证服务器迁移版本、数据数量、健康页和真实浏览器流程。

