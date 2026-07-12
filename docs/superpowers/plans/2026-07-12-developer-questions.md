# Developer Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-scoped developer questions with screenshot conversations and role-specific list pinning, while preserving the existing customer-request workflow.

**Architecture:** Store developer questions, messages, attachments, and events in independent SQLite tables. Expose focused question services and routes, then merge normalized question and request DTOs in a work-list service before pagination. Reuse the existing authenticated storage, attachment validation, lightbox, action-result, project access, and optimistic-version patterns.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, better-sqlite3, Zod, Vitest, Testing Library, Playwright, local filesystem image storage.

## Global Constraints

- The approved behavior is defined in `docs/superpowers/specs/2026-07-12-developer-questions-design.md`.
- Keep customer requests and developer questions as separate persistence domains.
- Use `ASK-000001` identifiers and the states `WAITING_CUSTOMER`, `WAITING_DEVELOPER`, and `SEEN`.
- Initial questions and every reply require text and may include up to 8 PNG/JPEG/WebP images, 10 MiB each and 30 MiB total.
- Project deactivation makes existing questions read-only.
- Every write uses authorization, idempotency where applicable, an immediate transaction, and optimistic version checks.
- Do not commit runtime databases, uploads, credentials, browser artifacts, or secrets.

---

### Task 1: Database schema and identifiers

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/types.ts`
- Create: `src/lib/question-number.ts`
- Create: `drizzle/0003_developer_questions.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `tests/unit/lib/question-number.test.ts`
- Modify: `tests/helpers/test-database.ts`

**Interfaces:**
- Produces: `formatQuestionNumber(id: number): string`, `parseQuestionNumber(value: string): number | null`.
- Produces: `developerQuestions`, `developerQuestionMessages`, `developerQuestionAttachments`, `developerQuestionEvents` and their inferred types.

- [ ] **Step 1: Write failing identifier and migration tests**

```ts
expect(formatQuestionNumber(12)).toBe("ASK-000012");
expect(parseQuestionNumber("ask-000012")).toBe(12);
expect(parseQuestionNumber("REQ-000012")).toBeNull();
```

- [ ] **Step 2: Run tests and confirm missing exports fail**

Run: `npm test -- tests/unit/lib/question-number.test.ts`

- [ ] **Step 3: Add the four tables, enums, constraints, indexes, types, migration, and number helpers**

The schema must implement the exact columns and foreign keys from the approved spec. Attachment `message_id` is nullable; event types are `QUESTION_CREATED`, `DEVELOPER_FOLLOWED_UP`, `CUSTOMER_REPLIED`, and `MARKED_SEEN`.

- [ ] **Step 4: Verify migration and unit tests**

Run: `npm test -- tests/unit/lib/question-number.test.ts tests/unit/db/client.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/db src/lib/question-number.ts drizzle tests/unit/lib/question-number.test.ts tests/helpers/test-database.ts
git commit -m "feat: add developer question schema"
```

### Task 2: Question domain service with screenshot transactions

**Files:**
- Create: `src/features/developer-questions/schemas.ts`
- Create: `src/features/developer-questions/presenter.ts`
- Create: `src/features/developer-questions/service.ts`
- Create: `src/features/developer-questions/queries.ts`
- Create: `tests/integration/developer-questions/developer-questions.test.ts`
- Reuse: `src/features/attachments/storage.ts`
- Reuse: `src/features/attachments/validation.ts`

**Interfaces:**
- Produces: `createDeveloperQuestion(database, actor, input, files, paths)`.
- Produces: `appendDeveloperQuestionMessage(database, actor, input, files, paths)`.
- Produces: `markDeveloperQuestionSeen(database, actor, input)`.
- Produces: `getDeveloperQuestionDetail`, `listDeveloperQuestionMessages`, `listDeveloperQuestionEvents`.

- [ ] **Step 1: Write failing service tests**

Cover developer-only creation, project customer access, non-member denial, three-state transitions, multi-customer reply behavior, follow-up reactivation, seen conflicts, stopped-project writes, version conflicts, idempotency, screenshot validation, and rollback cleanup.

- [ ] **Step 2: Run the new integration test and confirm failures**

Run: `npm test -- tests/integration/developer-questions/developer-questions.test.ts`

- [ ] **Step 3: Implement schemas and transactional writes**

```ts
export const questionContentSchema = z.string().trim().min(1).max(10_000);
export const createDeveloperQuestionSchema = z.object({
  projectId: z.number().int().positive(),
  content: questionContentSchema,
  idempotencyKey: z.string().trim().min(1).max(128),
});
```

Stage files before the transaction, commit files inside the immediate transaction, persist rows and events atomically, and remove committed files after a failed transaction. Use the existing structured cleanup logging convention.

- [ ] **Step 4: Implement access-controlled detail, messages, events, and attachment DTOs**

Customer queries must join `project_memberships`; developer queries may read all questions. All presenters suppress internal storage names.

- [ ] **Step 5: Run focused and regression tests**

Run: `npm test -- tests/integration/developer-questions/developer-questions.test.ts tests/integration/attachments/attachments.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/features/developer-questions tests/integration/developer-questions
git commit -m "feat: implement developer question workflow"
```

### Task 3: Authenticated APIs and lightweight actions

**Files:**
- Create: `src/app/api/developer-questions/route.ts`
- Create: `src/app/api/developer-questions/[questionId]/messages/route.ts`
- Create: `src/app/api/developer-question-attachments/[attachmentId]/route.ts`
- Create: `src/features/developer-questions/runtime-actions.ts`
- Create: `tests/integration/api/developer-question-route.test.ts`

**Interfaces:**
- Produces: multipart POST APIs returning `ActionResult` JSON.
- Produces: `markDeveloperQuestionSeenRuntimeAction(questionId, expectedVersion)`.

- [ ] **Step 1: Write failing route tests**

Test authentication, same-origin rejection, multipart bounds, role authorization, project IDOR, attachment IDOR, cache headers, invalid identifiers, and successful image responses.

- [ ] **Step 2: Run route tests and confirm missing handlers fail**

Run: `npm test -- tests/integration/api/developer-question-route.test.ts`

- [ ] **Step 3: Implement bounded multipart handlers and attachment streaming**

Reuse `boundedMultipartFormData`, `attachmentFiles`, `routeFailure`, `assertSameOrigin`, and the existing safe file resolver. The attachment route returns `nosniff`, private no-store caching, the detected MIME type, and a content disposition filename.

- [ ] **Step 4: Implement mark-seen Server Action**

The action resolves the live actor, calls the domain service, revalidates `/requests` and the question detail route, and returns a Chinese `ActionResult` error on conflicts.

- [ ] **Step 5: Verify focused tests**

Run: `npm test -- tests/integration/api/developer-question-route.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/app/api/developer-* src/features/developer-questions/runtime-actions.ts tests/integration/api/developer-question-route.test.ts
git commit -m "feat: expose developer question APIs"
```

### Task 4: Unified work-list query and sorting

**Files:**
- Create: `src/features/work-items/types.ts`
- Create: `src/features/work-items/queries.ts`
- Modify: `src/features/requests/schemas.ts`
- Modify: `src/app/(app)/requests/page.tsx`
- Create: `tests/integration/work-items/work-items.test.ts`
- Modify: `tests/unit/requests/sorting.test.ts`

**Interfaces:**
- Produces: discriminated `WorkItemDto = RequestWorkItemDto | DeveloperQuestionWorkItemDto`.
- Produces: `listWorkItems(database, actor, filters): ActionResult<WorkItemListResult>`.

- [ ] **Step 1: Write failing sorting, searching, filtering, and pagination tests**

Assert customer order `WAITING_CUSTOMER question -> request clarification -> normal records -> paused request`; developer order `WAITING_DEVELOPER question -> remaining updated records`. Test `ASK-*`, message text, project, record-kind filtering, request-only filters, totals, and page boundaries.

- [ ] **Step 2: Run focused tests and confirm failures**

Run: `npm test -- tests/integration/work-items/work-items.test.ts tests/unit/requests/sorting.test.ts`

- [ ] **Step 3: Implement candidate queries and stable merge-before-pagination**

Fetch only matching domain candidates, map them to a common sort rank and timestamp, sort by rank, `updatedAt DESC`, domain discriminator, and ID, then apply one offset/limit. Request-only filters must exclude questions.

- [ ] **Step 4: Switch the list page to the unified service**

Preserve existing redirects and error handling. Add `kind=ALL|REQUEST|QUESTION` URL parsing while maintaining current links.

- [ ] **Step 5: Verify tests**

Run: `npm test -- tests/integration/work-items/work-items.test.ts tests/integration/requests/request-service.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/features/work-items src/features/requests/schemas.ts 'src/app/(app)/requests/page.tsx' tests/integration/work-items tests/unit/requests/sorting.test.ts
git commit -m "feat: merge questions into work list"
```

### Task 5: Question creation, detail, conversation, and list UI

**Files:**
- Create: `src/app/(app)/questions/new/page.tsx`
- Create: `src/app/(app)/questions/[questionId]/page.tsx`
- Create: `src/features/developer-questions/components/question-form.tsx`
- Create: `src/features/developer-questions/components/question-detail.tsx`
- Create: `src/features/developer-questions/components/question-thread.tsx`
- Create: `src/features/developer-questions/components/question-history.tsx`
- Modify: `src/features/requests/components/request-list.tsx`
- Modify: `src/features/requests/components/request-toolbar.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/components/developer-question-form.test.tsx`
- Create: `tests/components/developer-question-detail.test.tsx`
- Modify: `tests/components/request-list.test.tsx`

**Interfaces:**
- Consumes: question APIs, `WorkItemDto`, `AttachmentGallery`, `ScreenshotInput`.
- Produces: accessible desktop/mobile screens and `data-attention="question-customer"|"question-developer"` list rows.

- [ ] **Step 1: Write failing component tests**

Test developer-only creation controls, paste/file screenshots, role-specific reply copy, screenshot previews, disabled stopped-project state, mark-seen button visibility, record-kind filter, labels, and row attention attributes.

- [ ] **Step 2: Run component tests and confirm failures**

Run: `npm test -- tests/components/developer-question-form.test.tsx tests/components/developer-question-detail.test.tsx tests/components/request-list.test.tsx`

- [ ] **Step 3: Implement creation and conversation forms**

Use controlled pending/error states, client-generated idempotency keys, `fetch` multipart calls, and full-page refresh after success. Do not expose shortcuts or instructional UI text.

- [ ] **Step 4: Implement detail and history pages**

Reuse the lightbox for every message attachment group. Keep the detail sections unframed and use the existing compact work-tool styling.

- [ ] **Step 5: Render mixed list rows and role-specific attention styling**

Use warm yellow for customer action, teal for developer action, a visible “开发者提问” badge, and stable table columns with dashes for request-only fields. Add the developer “新建开发者提问” command and record-kind filter.

- [ ] **Step 6: Verify components, type checking, and lint**

Run: `npm test -- tests/components/developer-question-form.test.tsx tests/components/developer-question-detail.test.tsx tests/components/request-list.test.tsx && npm run typecheck && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add src/app src/features/developer-questions/components src/features/requests/components src/app/globals.css tests/components
git commit -m "feat: add developer question interface"
```

### Task 6: Backup, integrity, seed, and documentation alignment

**Files:**
- Modify: `src/ops/backup.ts`
- Modify: `src/ops/attachment-integrity.ts`
- Modify: `src/ops/e2e-seed.ts`
- Modify: `docs/product.md`
- Modify: `docs/data-model.md`
- Modify: `docs/permissions.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/testing.md`
- Modify: `docs/traceability.md`
- Modify: `tests/integration/ops/attachment-check.test.ts`
- Modify: `tests/integration/ops/backup-restore.test.ts`

**Interfaces:**
- Backup manifests continue using format v2 but include the union of request and question attachment rows.
- Integrity checks report both attachment tables without leaking paths.

- [ ] **Step 1: Write failing operations tests with question attachments**

Assert backup copies and verifies both attachment kinds, restore retains them, missing/orphan detection includes question files, and duplicate storage names cannot silently pass.

- [ ] **Step 2: Run focused operations tests and confirm failures**

Run: `npm test -- tests/integration/ops/attachment-check.test.ts tests/integration/ops/backup-restore.test.ts`

- [ ] **Step 3: Extend attachment snapshots and consistency checks**

Use an explicit SQL `UNION ALL` ordered by storage name and reject duplicate storage names. Keep the manifest file format unchanged because attachment provenance is already represented in the database snapshot.

- [ ] **Step 4: Update canonical docs and E2E seed helpers**

Document the new role actions, tables, state machine, list order, screenshot rules, routes, tests, and recovery boundaries. Do not leave the original “客户需求 only” claims intact.

- [ ] **Step 5: Verify operations tests**

Run: `npm test -- tests/integration/ops/attachment-check.test.ts tests/integration/ops/backup-restore.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/ops src/ops/e2e-seed.ts docs tests/integration/ops
git commit -m "feat: cover questions in operations"
```

### Task 7: Full browser E2E, responsive QA, and production delivery

**Files:**
- Create: `e2e/developer-questions.spec.ts`
- Modify: `e2e/access-control.spec.ts`
- Modify: `e2e/responsive.spec.ts`
- Modify: `docs/testing.md`

**Interfaces:**
- Produces executable browser evidence for the complete approved lifecycle.

- [ ] **Step 1: Write the failing browser lifecycle test**

Automate developer creation with pasted PNG, customer top-row/color assertion, lightbox, customer screenshot reply, customer unpin, developer top-row/color assertion, mark seen, customer follow-up, developer re-question, second project customer response, and unassigned customer IDOR for page/API/image.

- [ ] **Step 2: Run the new E2E test and fix only evidenced defects**

Run: `npx playwright test e2e/developer-questions.spec.ts --project=chromium`

- [ ] **Step 3: Add responsive assertions**

Verify 1440x900, 390x844, and 360x800 have no page-level horizontal overflow, overlapping controls, clipped long words, blank lightboxes, or inaccessible close/navigation controls.

- [ ] **Step 4: Run every release gate**

```bash
npm test
npm run typecheck
npm run lint
npm run test:e2e
DATABASE_PATH=data/e2e/request-manager.db npm run build
npm audit
```

- [ ] **Step 5: Apply migration to the stopped live database, restart production, and smoke test**

Run backup first, stop the `13001` process, run `npm run db:migrate`, build, restart with `npm run start`, and verify both `http://localhost:13001` and `http://192.168.2.45:13001`. Use the real browser to execute the developer/customer question flow without leaving test data unless explicitly labeled.

- [ ] **Step 6: Commit and push the final iteration**

```bash
git add e2e docs/testing.md
git commit -m "test: verify developer question lifecycle"
git push origin HEAD
```
