# RequestManager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and release the approved two-role RequestManager as a complete local Next.js application backed by SQLite and protected local screenshot storage.

**Architecture:** A Next.js 16 App Router process owns server-rendered pages, authenticated Route Handlers and Server Actions. Drizzle ORM talks to one `better-sqlite3` connection behind domain services; those services enforce permissions, transitions, transactions and audit events before UI code sees data. Screenshot binaries live outside `public` and are reachable only through an authenticated route.

**Tech Stack:** Node.js 24, npm, Next.js 16.2.10, React 19.2.7, TypeScript, Drizzle ORM 0.45.2, better-sqlite3 12.11.1, SQLite, Zod 4.4.3, Tailwind CSS 4.3.2, Lucide React, Vitest 4.1.10, Testing Library, Playwright 1.61.1.

## Global Constraints

- UI copy is Simplified Chinese; source identifiers and file names remain English.
- Roles are exactly `CUSTOMER` and `DEVELOPER`; developers are equal administrators.
- Progress is exactly `UNSCHEDULED`, `SCHEDULED`, `COMPLETED`; record state is exactly `ACTIVE`, `PAUSED`, `ARCHIVED`.
- A customer edits only their own `ACTIVE + UNSCHEDULED` request and pauses only their own `ACTIVE + SCHEDULED` request.
- A clarification question marks a normal request as needing customer reply; the first valid project-customer reply clears it; no extra workflow status exists.
- Public remarks are customer-visible append-only records; private notes are one editable record per request and developer and never enter another user's response payload.
- Screenshot limits are PNG/JPEG/WebP, 10 MiB each, eight per request and 30 MiB total; files never live under `public`.
- No physical deletion of users, projects or requests; disabled and archived records retain history.
- One Node.js process owns one local SQLite file with `foreign_keys`, WAL and `busy_timeout` enabled.
- Every production behavior is introduced test-first; each RED run must fail for the expected missing behavior before implementation.
- Do not claim completion until typecheck, lint, unit/integration tests, E2E, production build, backup/restore and live browser checks all pass.

## Locked File Structure

```text
src/
  app/
    (auth)/login/
    (app)/account/password/
    (app)/manage/projects/
    (app)/manage/users/
    (app)/requests/new/
    (app)/requests/[requestId]/edit/
    (app)/requests/[requestId]/
    (app)/requests/
    api/attachments/[attachmentId]/
    api/requests/[requestId]/
    api/requests/
  auth/                 password, sessions, guards and login throttling
  components/           visual primitives and app shell only
  db/                   schema, connection, migrations and typed DB contract
  features/accounts/    account commands and queries
  features/projects/    project commands and queries
  features/requests/    request rules, commands, queries and presentation mapping
  features/communication/ remarks, notes and clarification services
  features/attachments/ file validation, staging, commit and authorized streaming
  lib/                  env, action results, time, IDs, CSRF and formatting
scripts/                migration, bootstrap, E2E seed, backup, restore, attachment check
tests/                  fixtures, unit, integration and browser tests
docs/                   product, architecture, schema, permissions, operations, testing, traceability
drizzle/                committed SQL migrations
data/                   ignored runtime database, uploads, temp and backups
```

---

### Task 1: Scaffold, Configuration and Database Foundation

**Files:**
- Create: `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `.env.example`, `.gitignore`
- Create: `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `src/db/types.ts`, `drizzle.config.ts`
- Create: `tests/helpers/test-database.ts`, `tests/unit/db/client.test.ts`
- Create: `drizzle/0000_initial.sql`

**Interfaces:**
- Produces: `createDatabase(databasePath: string): AppDatabase`
- Produces: `migrateDatabase(db: AppDatabase): void`
- Produces: `closeDatabase(db: AppDatabase): void`
- Produces: all Drizzle table objects exported from `@/db/schema`

- [ ] **Step 1: Scaffold the generated Next.js shell and install locked dependencies**

Run:

```bash
npx create-next-app@16.2.10 . --typescript --eslint --tailwind --app --src-dir --import-alias '@/*' --use-npm --yes
npm install drizzle-orm@0.45.2 better-sqlite3@12.11.1 zod@4.4.3 lucide-react@1.24.0 clsx@2.1.1 tailwind-merge@3.6.0 file-type@22.0.1
npm install -D drizzle-kit@0.31.10 tsx@4.23.0 vitest@4.1.10 @playwright/test@1.61.1 @testing-library/react @testing-library/jest-dom jsdom@29.1.1 @types/better-sqlite3
```

Expected: dependency installation succeeds and the generated app starts without modifying the approved specification.

- [ ] **Step 2: Write the failing database configuration test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@/../tests/helpers/test-database";

describe("createDatabase", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  it("enables foreign keys, WAL and a busy timeout", () => {
    const testDb = createTestDatabase();
    cleanups.push(testDb.cleanup);
    expect(testDb.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(testDb.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(testDb.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
  });
});
```

- [ ] **Step 3: Run RED**

Run: `npm test -- tests/unit/db/client.test.ts`

Expected: FAIL because `createTestDatabase` and `createDatabase` do not exist.

- [ ] **Step 4: Implement the typed connection, complete schema and migration**

Define enums as literal tuples, declare the `users`, `sessions`, `authThrottle`, `projects`, `projectMemberships`, `requests`, `attachments`, `publicRemarks`, `privateNotes`, `clarificationMessages` and `requestEvents` tables, including foreign keys, unique idempotency constraints, timestamps and request `version`. `createDatabase` must execute:

```ts
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
return { sqlite, db: drizzle(sqlite, { schema }) };
```

Generate and commit explicit SQL with `npm run db:generate`; tests call `migrateDatabase` against a temporary file rather than using `push`.

- [ ] **Step 5: Run GREEN and the generated-app checks**

Run:

```bash
npm test -- tests/unit/db/client.test.ts
npm run typecheck
npm run lint
```

Expected: all commands pass with no warnings.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.ts tsconfig.json eslint.config.mjs postcss.config.mjs vitest.config.ts playwright.config.ts .env.example .gitignore src/db drizzle drizzle.config.ts tests/helpers tests/unit/db
git commit -m "build: scaffold Next.js and SQLite foundation"
```

### Task 2: Authentication and Session Security

**Files:**
- Create: `src/auth/password.ts`, `src/auth/session-service.ts`, `src/auth/current-user.ts`, `src/auth/authorization.ts`, `src/auth/throttle.ts`, `src/auth/actions.ts`
- Create: `src/lib/env.ts`, `src/lib/action-result.ts`, `src/lib/csrf.ts`
- Create: `tests/unit/auth/password.test.ts`, `tests/integration/auth/session.test.ts`, `tests/unit/lib/csrf.test.ts`

**Interfaces:**
- Produces: `hashPassword(password: string): Promise<string>` and `verifyPassword(password: string, encoded: string): Promise<boolean>`
- Produces: `createSession(db, userId, now?): { token: string; expiresAt: Date }`
- Produces: `getSessionUser(db, token, now?): AuthenticatedUser | null`, `revokeUserSessions(db, userId): void`
- Produces: `requireCustomer(actor)`, `requireDeveloper(actor)` and `canAccessProject(db, actor, projectId)`
- Produces: `loginAction`, `logoutAction`, `changeOwnPasswordAction`

- [ ] **Step 1: Write failing password and session tests**

```ts
it("stores a salted scrypt hash and verifies it in constant-time code", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  expect(first).toMatch(/^scrypt\$/);
  expect(first).not.toBe(second);
  await expect(verifyPassword("correct horse battery staple", first)).resolves.toBe(true);
  await expect(verifyPassword("wrong password", first)).resolves.toBe(false);
});

it("rejects a session immediately after the user is disabled", async () => {
  const { db, actor, token } = await authenticatedCustomerFixture();
  await disableFixtureUser(db, actor.id);
  expect(getSessionUser(db, token)).toBeNull();
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/auth/password.test.ts tests/integration/auth/session.test.ts tests/unit/lib/csrf.test.ts`

Expected: FAIL on missing password, session and same-origin implementations.

- [ ] **Step 3: Implement password hashing, database-backed sessions and login throttling**

Use Node `crypto.scrypt` with a 16-byte salt, 64-byte key, `N=16384`, `r=8`, `p=1`; compare decoded buffers with `timingSafeEqual`. Generate 32 random token bytes, store only `sha256(token)`, expire after seven days, and join the active user on every lookup. Persist a five-attempt/15-minute throttle window keyed by normalized username plus source hash. All login failures return the same public message.

- [ ] **Step 4: Implement Next.js cookie and action adapters**

Set `request_manager_session` with `httpOnly`, `sameSite: "lax"`, `path: "/"`, seven-day expiry and environment-controlled `secure`. `changeOwnPasswordAction` verifies the old password, replaces the hash, clears `mustChangePassword`, revokes every session and redirects to login. `assertSameOrigin` compares `Origin` with `APP_ORIGIN` or the request host.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- tests/unit/auth tests/integration/auth tests/unit/lib/csrf.test.ts`

Expected: password, session invalidation, generic login error, throttle and CSRF tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/auth src/lib tests/unit/auth tests/integration/auth tests/unit/lib
git commit -m "feat: add secure local authentication"
```

### Task 3: Developer-Managed Accounts and Projects

**Files:**
- Create: `src/features/accounts/schemas.ts`, `src/features/accounts/service.ts`, `src/features/accounts/queries.ts`, `src/features/accounts/actions.ts`
- Create: `src/features/projects/schemas.ts`, `src/features/projects/service.ts`, `src/features/projects/queries.ts`, `src/features/projects/actions.ts`
- Create: `tests/integration/accounts/accounts.test.ts`, `tests/integration/projects/projects.test.ts`

**Interfaces:**
- Produces: `createUser`, `updateUserIdentity`, `resetUserPassword`, `setUserActive`, `replaceCustomerMemberships`
- Produces: `createProject`, `updateProject`, `setProjectActive`, `listManageableProjects`
- All commands consume `(db: AppDatabase, actor: AuthenticatedUser, input)` and return a discriminated `Result`.

- [ ] **Step 1: Write failing permission and invariant tests**

```ts
it("prevents a developer from disabling self or the last active developer", async () => {
  const ctx = await developerFixture();
  await expect(setUserActive(ctx.db, ctx.actor, { userId: ctx.actor.id, active: false }))
    .rejects.toMatchObject({ code: "LAST_DEVELOPER" });
});

it("removes project access immediately when membership is revoked", async () => {
  const ctx = await twoProjectCustomerFixture();
  replaceCustomerMemberships(ctx.db, ctx.developer, { customerId: ctx.customer.id, projectIds: [] });
  expect(canAccessProject(ctx.db, ctx.customer, ctx.project.id)).toBe(false);
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/integration/accounts tests/integration/projects`

Expected: FAIL because account and project services are missing.

- [ ] **Step 3: Implement developer-only account commands**

Normalize usernames, enforce case-insensitive uniqueness, never expose password hashes, and use transactions for username changes, reset, activation and membership replacement. Reset creates a fresh scrypt hash, sets `mustChangePassword`, and revokes sessions. Role is chosen only at creation and is immutable thereafter.

- [ ] **Step 4: Implement project commands and read rules**

Project code and name are required and unique where applicable. Disabling blocks new requests while retaining read-only history for assigned customers. Membership replacement accepts only active customer accounts and existing projects.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- tests/integration/accounts tests/integration/projects`

Expected: role checks, uniqueness, session revocation, last-developer protection, disabled-project behavior and membership isolation pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/accounts src/features/projects tests/integration/accounts tests/integration/projects
git commit -m "feat: add account and project administration"
```

### Task 4: Request Domain, Permissions, Sorting and State Machine

**Files:**
- Create: `src/features/requests/constants.ts`, `src/features/requests/schemas.ts`, `src/features/requests/policy.ts`, `src/features/requests/service.ts`, `src/features/requests/queries.ts`, `src/features/requests/presenter.ts`, `src/features/requests/actions.ts`
- Create: `src/lib/request-number.ts`, `src/lib/domain-error.ts`
- Create: `tests/unit/requests/policy.test.ts`, `tests/unit/requests/sorting.test.ts`, `tests/integration/requests/request-service.test.ts`

**Interfaces:**
- Produces: `createRequest`, `updateOwnRequest`, `changeProgress`, `pauseRequest`, `resumeRequest`, `archiveRequest`, `restoreRequest`
- Produces: `getRequestDetail(db, actor, requestId)`, `listRequests(db, actor, filters)`
- Produces: `canEditRequest(actor, request)`, `assertValidStateCombination(progress, recordState)`
- Produces: `formatRequestNumber(id: number): string`, `parseRequestNumber(value: string): number | null`

- [ ] **Step 1: Write failing policy and state tests**

```ts
it("allows only the creator to edit an active unscheduled request", () => {
  expect(canEditRequest(customer("owner"), request({ createdById: "owner" }))).toBe(true);
  expect(canEditRequest(customer("peer"), request({ createdById: "owner" }))).toBe(false);
  expect(canEditRequest(customer("owner"), request({ progressStatus: "SCHEDULED" }))).toBe(false);
});

it("permits customer pause only for their own active scheduled request", () => {
  expect(decidePause(customer("owner"), request({ createdById: "owner", progressStatus: "SCHEDULED" }))).toEqual({ allowed: true });
  expect(decidePause(customer("peer"), request({ createdById: "owner", progressStatus: "SCHEDULED" })).allowed).toBe(false);
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/requests/policy.test.ts tests/unit/requests/sorting.test.ts tests/integration/requests/request-service.test.ts`

Expected: FAIL on missing request policy and service.

- [ ] **Step 3: Implement request validation and transactional commands**

Validate trimmed content at 10-10,000 characters and closed enums. Creation derives customer/project/initial states server-side and uses `(createdById, idempotencyKey)` uniqueness. Every mutable command reloads the row inside the transaction, checks project access and expected `version`, performs a conditional update, increments version, updates `updatedAt`, and appends a public audit event. Developers never receive a command that edits customer content.

- [ ] **Step 4: Implement authorized detail and globally sorted list queries**

Customer queries join current project membership. Developer queries cover all projects. Apply search and filters before pagination. Customer order is SQL `CASE`: active pending first, other active second, paused third, then `updatedAt DESC, id DESC`; archived is excluded unless explicitly filtered. DTOs omit database-only idempotency keys and all private-note fields.

- [ ] **Step 5: Verify stale-edit and IDOR boundaries**

Add integration assertions that an open customer form cannot overwrite a request after developer scheduling, another project cannot read or mutate a guessed request ID, paused combinations remain `SCHEDULED + PAUSED`, and archived restore preserves progress while returning to `ACTIVE`.

- [ ] **Step 6: Run GREEN**

Run: `npm test -- tests/unit/requests tests/integration/requests`

Expected: policy, state, stable sorting, paging, idempotency, audit and concurrent-version tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/requests src/lib/request-number.ts src/lib/domain-error.ts tests/unit/requests tests/integration/requests
git commit -m "feat: implement request lifecycle"
```

### Task 5: Protected Screenshot Pipeline and Multipart Request APIs

**Files:**
- Create: `src/features/attachments/constants.ts`, `src/features/attachments/validation.ts`, `src/features/attachments/storage.ts`, `src/features/attachments/service.ts`, `src/features/attachments/authorization.ts`
- Create: `src/app/api/requests/route.ts`, `src/app/api/requests/[requestId]/route.ts`, `src/app/api/attachments/[attachmentId]/route.ts`
- Create: `tests/fixtures/images.ts`, `tests/unit/attachments/validation.test.ts`, `tests/integration/attachments/attachments.test.ts`, `tests/integration/api/request-route.test.ts`

**Interfaces:**
- Produces: `stageAttachments(files: File[], paths: StoragePaths): Promise<StagedAttachment[]>`
- Produces: `commitStagedAttachments`, `discardStagedAttachments`, `removeCommittedAttachments`
- Produces: `createRequestWithAttachments`, `editRequestWithAttachments`
- Route contract: `POST /api/requests`, `PUT /api/requests/:requestNo`, `GET /api/attachments/:id`

- [ ] **Step 1: Write failing signature and limit tests**

```ts
it.each([
  [pngFile(), "image/png"],
  [jpegFile(), "image/jpeg"],
  [webpFile(), "image/webp"],
])("accepts supported image signatures", async (file, mime) => {
  await expect(validateImageFile(file)).resolves.toMatchObject({ mimeType: mime });
});

it("rejects SVG even when its declared MIME is image/png", async () => {
  await expect(validateImageFile(fakePngSvg())).rejects.toMatchObject({ code: "ATTACHMENT_INVALID" });
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/attachments/validation.test.ts tests/integration/attachments tests/integration/api/request-route.test.ts`

Expected: FAIL because attachment validators, storage and routes are missing.

- [ ] **Step 3: Implement validation and protected local storage**

Read at most 10 MiB plus one byte per file, detect content with `file-type`, enforce count and total size including retained attachments, compute SHA-256, and write to `data/tmp` under a random UUID. Commit uses atomic rename into a two-character prefix directory below `data/uploads`; paths are derived only from generated storage names.

- [ ] **Step 4: Implement atomic create/edit coordination**

Stage before the database transaction. Inside the transaction recheck authorization/state/version, move new files, insert/delete attachment rows and update the request. On any exception remove newly moved files and all temp files. After a successful edit commit, delete removed physical files; failures are logged for the consistency checker.

- [ ] **Step 5: Implement same-origin multipart routes and authenticated image streaming**

`POST` and `PUT` parse `FormData`, validate origin and session, and return stable JSON `{ ok, data | code, message, fieldErrors }`. The GET route resolves the attachment through the request and current project authorization, streams with the stored MIME and `X-Content-Type-Options: nosniff`, and returns 404 for both missing and unauthorized resources.

- [ ] **Step 6: Run GREEN**

Run: `npm test -- tests/unit/attachments tests/integration/attachments tests/integration/api`

Expected: MIME spoofing, limits, path traversal, orphan cleanup, stale edit, unauthorized URL, logout and membership revocation tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/attachments src/app/api tests/fixtures tests/unit/attachments tests/integration/attachments tests/integration/api
git commit -m "feat: secure request screenshot storage"
```

### Task 6: Public Remarks, Private Notes and Simple Clarification

**Files:**
- Create: `src/features/communication/schemas.ts`, `src/features/communication/policy.ts`, `src/features/communication/service.ts`, `src/features/communication/queries.ts`, `src/features/communication/actions.ts`
- Create: `tests/unit/communication/policy.test.ts`, `tests/integration/communication/communication.test.ts`

**Interfaces:**
- Produces: `addPublicRemark`, `saveOwnPrivateNote`, `askClarification`, `replyToClarification`
- Produces: `listPublicRemarks`, `getOwnPrivateNote`, `listClarificationMessages`
- All append operations accept `idempotencyKey`; note upsert is keyed by `(requestId, developerId)`.

- [ ] **Step 1: Write failing clarification and privacy tests**

```ts
it("sets pending on a developer question and clears it on the first project-customer reply", async () => {
  const ctx = await communicationFixture();
  await askClarification(ctx.db, ctx.developer, question(ctx.request));
  expect(await requestPending(ctx.db, ctx.request.id)).toBe(true);
  await replyToClarification(ctx.db, ctx.customer, reply(ctx.request));
  expect(await requestPending(ctx.db, ctx.request.id)).toBe(false);
});

it("never returns developer A's private note to developer B", async () => {
  const ctx = await twoDeveloperFixture();
  await saveOwnPrivateNote(ctx.db, ctx.developerA, note(ctx.request, "A only"));
  expect(await getOwnPrivateNote(ctx.db, ctx.developerB, ctx.request.id)).toBeNull();
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/communication tests/integration/communication`

Expected: FAIL on missing communication policy and services.

- [ ] **Step 3: Implement the three intentionally separate communication models**

Public remark and clarification messages are append-only, escaped plain text with author/time and unique idempotency keys. Private note is a developer-only upsert whose query always includes the current developer ID. Private-note content is absent from request DTOs, audit payloads, logs and other developers' queries.

- [ ] **Step 4: Implement clarification transaction rules**

Developer question writes a message and sets pending true in one transaction. A current project customer may reply only while the active request is pending; the first committed reply clears pending, and a stale second reply gets `STATE_CONFLICT`. Paused/archived records reject communication. Restore recomputes pending from the last clarification author role.

- [ ] **Step 5: Run GREEN including cross-account payload assertions**

Run: `npm test -- tests/unit/communication tests/integration/communication`

Expected: pending, repeated question, cross-customer reply, public remark independence, pause suppression, restore recomputation, idempotency and private payload isolation pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/communication tests/unit/communication tests/integration/communication
git commit -m "feat: add request communication tools"
```

### Task 7: Application Shell, Login and Customer Request Experience

**Files:**
- Modify: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- Create: `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/requests/page.tsx`, `src/app/(app)/requests/new/page.tsx`, `src/app/(app)/requests/[requestId]/page.tsx`, `src/app/(app)/requests/[requestId]/edit/page.tsx`, `src/app/(app)/account/password/page.tsx`
- Create: `src/components/ui/button.tsx`, `src/components/ui/icon-button.tsx`, `src/components/ui/field.tsx`, `src/components/ui/badge.tsx`, `src/components/ui/pagination.tsx`, `src/components/app-shell.tsx`, `src/components/page-header.tsx`, `src/components/confirm-dialog.tsx`
- Create: `src/features/accounts/components/login-form.tsx`, `src/features/accounts/components/password-form.tsx`
- Create: `src/features/requests/components/request-toolbar.tsx`, `src/features/requests/components/request-list.tsx`, `src/features/requests/components/request-form.tsx`, `src/features/requests/components/request-detail.tsx`, `src/features/requests/components/request-actions.tsx`
- Create: `src/features/attachments/screenshot-input.tsx`, `src/features/attachments/attachment-gallery.tsx`
- Create: `src/features/communication/components/public-remarks.tsx`, `src/features/communication/components/clarification-thread.tsx`, `src/features/communication/components/private-note-editor.tsx`
- Create: `tests/components/screenshot-input.test.tsx`, `tests/components/request-list.test.tsx`

**Interfaces:**
- Pages consume only authorized DTOs from feature query modules.
- `RequestForm` submits multipart data to the create/edit API with a stable idempotency key and expected version.
- `RequestList` receives already globally sorted/paginated results and never performs client-only priority sorting.

- [ ] **Step 1: Write failing component behavior tests**

```tsx
it("adds an image clipboard item without treating plain text as an attachment", async () => {
  render(<ScreenshotInput value={[]} onChange={onChange} />);
  await userEvent.paste(screen.getByLabelText("需求内容"), "纯文本");
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.paste(screen.getByTestId("screenshot-input"), clipboardWithPng());
  expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ type: "image/png" })]);
});

it("renders text as well as color for pending customer replies", () => {
  render(<RequestList role="CUSTOMER" items={[pendingRequestDto()]} />);
  expect(screen.getByText("待您回复")).toBeVisible();
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/components/screenshot-input.test.tsx tests/components/request-list.test.tsx`

Expected: FAIL because customer components do not exist.

- [ ] **Step 3: Build the quiet, responsive visual system and protected shell**

Use CSS variables for neutral surfaces, charcoal text, teal actions, amber priority and red pending state; do not use gradients, decorative floating sections or nested cards. Use Lucide icons in icon buttons with accessible names/tooltips. The protected layout awaits `requireCurrentUser`, redirects forced-password users, and renders desktop sidebar plus mobile header without trusting client role state.

- [ ] **Step 4: Build login, password, list, request form and detail pages**

Keep labels and errors in Chinese. Desktop list is a dense table; below 768 px it becomes fixed-dimension compact rows. Search and filters live in URL parameters. New/edit supports paste, drag, select, preview, removal, disabled submit and error recovery. Detail renders only role-appropriate sections and uses confirmation for pause/archive actions.

- [ ] **Step 5: Run component GREEN and accessibility assertions**

Run: `npm test -- tests/components`

Expected: clipboard, limit messaging, pending text, role controls, form error association and stable mobile-row tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app src/components src/features/*/components tests/components
git commit -m "feat: build customer request experience"
```

### Task 8: Developer Management Screens and Full Request Workbench

**Files:**
- Create: `src/app/(app)/manage/projects/page.tsx`, `src/app/(app)/manage/users/page.tsx`
- Create: `src/features/projects/components/project-manager.tsx`, `src/features/projects/components/project-form.tsx`
- Create: `src/features/accounts/components/user-manager.tsx`, `src/features/accounts/components/user-form.tsx`, `src/features/accounts/components/membership-editor.tsx`, `src/features/accounts/components/reset-password-form.tsx`
- Create: `tests/components/developer-workbench.test.tsx`, `tests/integration/pages/role-guards.test.ts`

**Interfaces:**
- Management pages call `requireDeveloper` before loading any management DTO.
- Forms consume the account/project actions defined in Task 3 and revalidate exact list/detail paths.
- Request detail consumes Task 4 and Task 6 actions for status, record state, remark, note and clarification.

- [ ] **Step 1: Write failing role and visibility tests**

```ts
it("returns not found when a customer requests a management page", async () => {
  const response = await renderRouteAs("/manage/users", customerFixtureUser());
  expect(response.status).toBe(404);
});

it("keeps another developer's private note out of rendered payload", async () => {
  const html = await renderRequestDetailAs(developerBFixture());
  expect(html).not.toContain("A only secret note");
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/components/developer-workbench.test.tsx tests/integration/pages/role-guards.test.ts`

Expected: FAIL because developer pages and forms are absent.

- [ ] **Step 3: Implement project and user administration**

Use compact tables and dialogs for clear commands only. Show account role, enabled state, forced-password state and project memberships. Developers can create, rename, reset, enable/disable and replace memberships; confirmations name the affected account/project. The UI must surface last-developer/self-disable errors returned by the server.

- [ ] **Step 4: Complete the developer request workbench**

On request detail, developers can change progress, pause/resume/archive/restore, append public remarks, edit only their private note and ask clarification. Show public history with author/time and keep the three communication controls visually and semantically separate.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- tests/components/developer-workbench.test.tsx tests/integration/pages/role-guards.test.ts`

Expected: management guards, action visibility, note payload isolation and all server error presentations pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/'(app)'/manage src/features/accounts/components src/features/projects/components tests/components/developer-workbench.test.tsx tests/integration/pages
git commit -m "feat: add developer administration workbench"
```

### Task 9: Migration, Bootstrap, Backup, Restore and Attachment Integrity

**Files:**
- Create: `src/ops/paths.ts`, `src/ops/manifest.ts`, `src/ops/structured-log.ts`
- Create: `scripts/migrate.ts`, `scripts/init-developer.ts`, `scripts/backup.ts`, `scripts/restore.ts`, `scripts/check-attachments.ts`, `scripts/e2e-seed.ts`
- Create: `tests/integration/ops/bootstrap.test.ts`, `tests/integration/ops/backup-restore.test.ts`, `tests/integration/ops/attachment-check.test.ts`
- Modify: `package.json`, `.env.example`, `.gitignore`

**Interfaces:**
- Commands: `npm run db:migrate`, `npm run admin:init`, `npm run ops:backup`, `npm run ops:restore -- <backup-dir>`, `npm run ops:attachments:check`, `npm run ops:attachments:repair`
- Produces: versioned JSON `BackupManifest` with database and attachment SHA-256 values.

- [ ] **Step 1: Write failing operational integrity tests**

```ts
it("refuses to overwrite the first developer on repeated initialization", async () => {
  const first = await runInitDeveloper(envFor("admin", "first password"));
  const second = await runInitDeveloper(envFor("admin", "changed password"));
  expect(first.exitCode).toBe(0);
  expect(second.exitCode).not.toBe(0);
  await expect(login("admin", "first password")).resolves.toBeTruthy();
});

it("restores a consistent database and protected screenshot set", async () => {
  const backup = await createPopulatedBackup();
  await mutateLiveData();
  await restoreBackup(backup.path);
  expect(await restoredRequestWithImage()).toEqual(backup.expected);
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/integration/ops`

Expected: FAIL because operational commands and manifests are absent.

- [ ] **Step 3: Implement explicit migration and safe first-developer initialization**

Migration prints before/after schema version and never runs implicitly in production startup. Initialization reads username, display name and password from explicit environment variables, validates them, and creates only when no enabled developer exists; it never logs the password.

- [ ] **Step 4: Implement backup and restore**

Backup checkpoints WAL, uses the SQLite online backup API, copies only attachment rows present in the snapshot, hashes every file, writes a `.partial` directory and atomically renames on success. Restore requires an explicit confirmation flag, verifies all hashes, stages database/uploads beside live data, then atomically swaps while the documented process is stopped; failure leaves live paths unchanged.

- [ ] **Step 5: Implement default-report attachment checking**

Report missing, orphaned, wrong-size and wrong-hash files. Default never mutates. `--apply` removes only confirmed orphan files and still does not invent or delete database rows for missing files.

- [ ] **Step 6: Run GREEN and rehearse commands on temporary paths**

Run: `npm test -- tests/integration/ops`

Expected: initialization idempotence, manifest validation, restore rollback, round-trip content and report-only checker tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/ops scripts tests/integration/ops package.json .env.example .gitignore
git commit -m "feat: add local operations and recovery tools"
```

### Task 10: Browser Acceptance, Documentation and Release Gate

**Files:**
- Create: `e2e/global-setup.ts`, `e2e/fixtures.ts`, `e2e/auth.spec.ts`, `e2e/request-lifecycle.spec.ts`, `e2e/access-control.spec.ts`, `e2e/private-notes.spec.ts`, `e2e/responsive.spec.ts`, `e2e/fixtures/screenshot.png`
- Create: `README.md`, `docs/product.md`, `docs/architecture.md`, `docs/data-model.md`, `docs/permissions.md`, `docs/user-guide.md`, `docs/operations.md`, `docs/testing.md`, `docs/security.md`, `docs/traceability.md`
- Modify: `docs/superpowers/specs/2026-07-10-request-manager-design.md`, `playwright.config.ts`, `package.json`

**Interfaces:**
- E2E fixture users: developer A, developer B, project-A customer A, project-A customer B and unassigned customer.
- Traceability maps `AUTH`, `PROJ`, `REQ`, `STATE`, `COMM`, `ATT`, `OPS`, `UX` to implementation modules and automated/manual evidence.

- [ ] **Step 1: Write browser tests before completing browser-specific glue**

The lifecycle test must create a request using an image `DataTransfer`, schedule it, add public/private text, ask, assert global red pending priority, reply, assert removal, ask again, pause, restore, archive and find it through the archived filter. Access tests must visit guessed detail/action/image URLs. Private-note tests inspect rendered HTML and network payload for the other developer's secret value.

- [ ] **Step 2: Run E2E RED**

Run: `npm run test:e2e`

Expected: FAIL at the first missing browser integration or selector, not from missing browser binaries or seed setup.

- [ ] **Step 3: Complete browser glue and responsive behavior**

Fix only behavior required by failing tests. Run Chromium desktop plus Mobile Chrome. At 1440x900, 1024x768, 390x844 and 360x800 assert no horizontal overflow, obscured controls or layout shifts; screenshots use fixed aspect ratio and `object-fit: contain`.

- [ ] **Step 4: Write the full aligned documentation set**

README gives a five-minute start. Architecture explains module and transaction flows. Data model lists every table/constraint. Permissions reproduces the enforced matrix. User guide covers both roles without implementation jargon. Operations documents migration/bootstrap/backup/stopped restore/checker. Testing separates automated clipboard simulation from real system clipboard smoke evidence. Security covers scrypt, session digest, origin checks, IDOR and uploads. Traceability points every approved requirement to concrete files/tests. Mark the approved specification “Implemented and verified” only after all gates pass.

- [ ] **Step 5: Run the complete automated gate**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Expected: every command exits zero with no unhandled browser console error.

- [ ] **Step 6: Rehearse fresh install and disaster recovery**

On isolated data paths: migrate an empty database, initialize a developer, verify repeated initialization refusal, create a screenshot request, back up, mutate, stop the app, restore, restart, and verify the original request plus image. Create one orphan file and one missing-file condition; prove check is report-only and repair removes only the orphan.

- [ ] **Step 7: Verify the actual running app**

Start the production build on an unused localhost port, use real browser sessions for both roles, paste once from the operating-system clipboard, and capture desktop/mobile evidence. Confirm the process command/cwd uses the current build before declaring runtime completion.

- [ ] **Step 8: Self-review documentation and diff, then commit**

Run:

```bash
rg -n 'TB[D]|TO[D]O|FIXM[E]|placeholde[r]|implement late[r]' README.md docs src tests e2e
git diff --check
git status --short
```

Expected: no placeholders, whitespace errors, generated runtime data or unrelated changes.

```bash
git add README.md docs package.json playwright.config.ts e2e src tests scripts
git commit -m "docs: complete RequestManager release evidence"
```
