# Request Communication Images and Completion Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add protected screenshots to public remarks and clarification messages, add persistent editable completion notes with screenshots, apply semantic progress colors, and release through a mandatory remote-backup gate.

**Architecture:** Keep each communication entity and its attachments in explicit SQLite tables, while reusing the existing staging, signature validation, protected file layout, authorization, backup, and integrity machinery. Introduce multipart Route Handlers for image-bearing communication and completion writes; completion changes combine optimistic request-version updates, note upserts, attachment replacement, and audit events in one immediate transaction.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, better-sqlite3, SQLite, Zod, Vitest, Testing Library, Playwright, local protected image storage, Bash/Docker deployment.

## Global Constraints

- Public remarks, developer clarification questions, and customer clarification replies accept PNG, JPEG, and WebP through selection, drag/drop, or `Ctrl+V`.
- Each new message or completion-note update accepts at most 8 images, 10 MiB per image, and 30 MiB combined.
- Public-remark and clarification bodies remain required; completion-note text and images are optional.
- Completion notes persist when progress moves away from `COMPLETED`; paused and archived requests remain read-only.
- Only developers may write completion notes; authorized customers may read them.
- Progress colors are `UNSCHEDULED` gray, `SCHEDULED` blue, and `COMPLETED` green in list and detail views.
- Every public release must first create a complete remote backup. Backup failure aborts before migration, stop, or replacement.
- Normal release uses code-only `update`; local SQLite and screenshots must never overwrite public data.

---

### Task 1: Schema, Types, Migration, and Attachment Ownership

**Files:**
- Create: `drizzle/0005-communication-images-completion-notes.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema.ts`
- Modify: `src/db/types.ts`
- Modify: `src/features/attachments/queries.ts`
- Test: `tests/unit/db/client.test.ts`

**Interfaces:**
- Produces: `publicRemarkAttachments`, `clarificationMessageAttachments`, `completionNotes`, `completionNoteAttachments` Drizzle tables and inferred row types.
- Produces: attachment DTO queries keyed by public remark, clarification message, and completion note.

- [ ] **Step 1: Write failing migration tests**

Add assertions that an existing four-migration database upgrades without changing existing users, requests, remarks, or clarification messages; the four new tables exist; `completion_notes.request_id` is unique; attachment storage names are unique; and invalid foreign keys fail.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/db/client.test.ts`  
Expected: FAIL because migration `0005` and the new schema exports do not exist.

- [ ] **Step 3: Add explicit tables and migration**

Define each attachment table with `requestId`, entity foreign key, `uploadedById`, `storageName`, `originalName`, `mimeType`, `sizeBytes`, `sha256`, and `createdAt`. Define `completionNotes` with unique `requestId`, `content`, `updatedById`, `createdAt`, and `updatedAt`. Add indexes on request/entity IDs and size checks.

- [ ] **Step 4: Add typed attachment query helpers**

Return the existing `{ id, originalName, mimeType, sizeBytes, createdAt, url }` DTO shape with entity-specific protected URLs.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- tests/unit/db/client.test.ts`  
Expected: all database configuration and migration tests pass.

- [ ] **Step 6: Commit**

```bash
git add drizzle src/db src/features/attachments/queries.ts tests/unit/db/client.test.ts
git commit -m "feat: add communication and completion attachment schema"
```

### Task 2: Transactional Communication Attachments and Protected Reads

**Files:**
- Modify: `src/features/communication/schemas.ts`
- Modify: `src/features/communication/service.ts`
- Modify: `src/features/communication/queries.ts`
- Create: `src/features/communication/attachment-service.ts`
- Create: `src/app/api/requests/[requestId]/public-remarks/route.ts`
- Create: `src/app/api/requests/[requestId]/clarifications/route.ts`
- Create: `src/app/api/public-remark-attachments/[attachmentId]/route.ts`
- Create: `src/app/api/clarification-attachments/[attachmentId]/route.ts`
- Modify: `src/app/api/requests/route-support.ts`
- Test: `tests/integration/communication/communication.test.ts`
- Test: `tests/integration/api/request-route.test.ts`
- Test: `tests/integration/attachments/attachments.test.ts`

**Interfaces:**
- Produces: `addPublicRemarkWithAttachments(database, actor, input, files, paths)`.
- Produces: `appendClarificationWithAttachments(database, actor, input, files, paths)` which dispatches by live actor role while preserving existing attention rules.
- Produces: protected GET handlers for both communication attachment kinds.

- [ ] **Step 1: Write failing domain tests**

Cover developer remark images, developer clarification images, customer reply images, immutable idempotency fingerprints, stale versions, revoked membership, inactive projects, invalid images, and cleanup after a failed database write.

- [ ] **Step 2: Run domain RED**

Run: `npm test -- tests/integration/communication/communication.test.ts tests/integration/attachments/attachments.test.ts`  
Expected: FAIL because communication services accept text only and expose no attachment DTOs.

- [ ] **Step 3: Implement staged transactional writes**

Reuse `stageAttachments`, `commitStagedAttachments`, `discardStagedAttachments`, and `removeCommittedAttachments`. Compute SHA-256 idempotency fingerprints from normalized message text plus ordered attachment metadata. Insert message, attachment rows, request version update, and audit event inside one immediate transaction.

- [ ] **Step 4: Write failing multipart and download tests**

Cover same-origin enforcement, bounded multipart parsing, unauthenticated access, MIME spoofing, attachment size/count limits, revoked project access, `private, no-store`, and `nosniff`.

- [ ] **Step 5: Run route RED**

Run: `npm test -- tests/integration/api/request-route.test.ts`  
Expected: FAIL because the new routes do not exist.

- [ ] **Step 6: Implement routes and protected streaming**

Resolve stable request numbers, reuse `boundedMultipartFormData`, validate `expectedVersion` and `idempotencyKey`, and stream only regular files opened with `O_NOFOLLOW` after live authorization.

- [ ] **Step 7: Run GREEN**

Run: `npm test -- tests/integration/communication/communication.test.ts tests/integration/attachments/attachments.test.ts tests/integration/api/request-route.test.ts`  
Expected: all focused domain and route tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/features/communication src/app/api tests/integration
git commit -m "feat: support screenshots in request communication"
```

### Task 3: Completion Note Domain and Multipart Completion Command

**Files:**
- Create: `src/features/completion-notes/schemas.ts`
- Create: `src/features/completion-notes/service.ts`
- Create: `src/features/completion-notes/queries.ts`
- Create: `src/app/api/requests/[requestId]/completion/route.ts`
- Create: `src/app/api/completion-note-attachments/[attachmentId]/route.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/features/requests/service.ts`
- Modify: `src/features/requests/queries.ts`
- Test: `tests/integration/completion-notes/completion-notes.test.ts`
- Test: `tests/integration/api/request-route.test.ts`
- Test: `tests/integration/requests/request-events.test.ts`

**Interfaces:**
- Produces: `saveCompletionNote(database, actor, input, files, paths)` for both completing and later editing.
- Produces: `getCompletionNote(database, actor, requestId)` with attachment DTOs.
- Input: `{ requestId, expectedVersion, content, retainedAttachmentIds, completeRequest }`.

- [ ] **Step 1: Write failing completion-domain tests**

Cover empty completion, completion with text/images, later add/edit/remove, persistence after progress rollback, customer read, customer write rejection, paused/archived rejection, stale versions, and event payload privacy.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/integration/completion-notes/completion-notes.test.ts tests/integration/requests/request-events.test.ts`  
Expected: FAIL because the completion-note module and events do not exist.

- [ ] **Step 3: Implement the atomic completion service**

Within one immediate transaction, re-read the developer and request, verify active record state and version, optionally move progress to `COMPLETED`, upsert or remove the empty note as appropriate, replace retained/new attachments, increment the request version, and append allow-listed public events without note text.

- [ ] **Step 4: Add the multipart completion API and protected read route**

Use the same bounded form and attachment storage pipeline. A no-content/no-file completion remains valid; a later empty save removes the note and its files without changing progress.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- tests/integration/completion-notes/completion-notes.test.ts tests/integration/api/request-route.test.ts tests/integration/requests/request-events.test.ts`  
Expected: all completion, API, and audit tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/completion-notes src/features/requests src/app/api tests/integration
git commit -m "feat: add persistent completion notes"
```

### Task 4: Request Detail UI, Paste Flows, and Progress Colors

**Files:**
- Modify: `src/features/communication/components/public-remarks.tsx`
- Modify: `src/features/communication/components/clarification-thread.tsx`
- Create: `src/features/completion-notes/components/completion-note-editor.tsx`
- Create: `src/features/completion-notes/components/complete-request-dialog.tsx`
- Modify: `src/features/requests/components/request-actions.tsx`
- Modify: `src/features/requests/components/request-detail.tsx`
- Modify: `src/features/requests/components/request-list.tsx`
- Modify: `src/app/(app)/requests/[requestId]/page.tsx`
- Modify: `src/components/ui/badge.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/components/developer-workbench.test.tsx`
- Test: `tests/components/request-detail.test.tsx`
- Test: `tests/components/request-list.test.tsx`
- Test: `tests/components/screenshot-input.test.tsx`

**Interfaces:**
- Consumes: communication multipart routes and completion-note DTO/API from Tasks 2-3.
- Produces: reusable progress tone mapping and complete-request dialog behavior.

- [ ] **Step 1: Write failing component tests**

Assert public remarks and clarification forms render `ScreenshotInput`, paste images into multipart submissions, render returned galleries, open the completion dialog when `COMPLETED` is selected, allow empty completion, retain/edit completion images, and apply neutral/info/success tones to unscheduled/scheduled/completed badges.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/components`  
Expected: focused assertions fail because the forms are text-only, completion has no dialog, and unscheduled uses the info tone.

- [ ] **Step 3: Convert communication forms to multipart client submissions**

Keep one stable idempotency key per attempt, append selected files as `attachments`, preserve accessible errors, reset only after success, refresh the route, and render `AttachmentGallery` per message.

- [ ] **Step 4: Add completion dialog and persistent editor**

Intercept only transitions to `COMPLETED`; other progress changes continue using the current Server Action. Submit optional text, retained IDs, and pasted files to the completion API. Render the note for both roles and editing controls only for developers on active requests.

- [ ] **Step 5: Apply semantic progress tones**

Add a `progressTone` helper or `blue` badge tone so list and detail use gray for `UNSCHEDULED`, blue for `SCHEDULED`, and green for `COMPLETED`, independent of attention-row styling.

- [ ] **Step 6: Run GREEN**

Run: `npm test -- tests/components`  
Expected: all component tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/features src/components src/app tests/components
git commit -m "feat: add completion and communication image workflows"
```

### Task 5: Backup, Restore, Integrity, Documentation, and Browser Acceptance

**Files:**
- Modify: `src/ops/backup.ts`
- Modify: `src/ops/attachment-integrity.ts`
- Modify: `src/ops/e2e-seed.ts`
- Modify: `tests/integration/ops/backup-restore.test.ts`
- Modify: `tests/integration/ops/attachment-check.test.ts`
- Modify: `e2e/request-lifecycle.spec.ts`
- Modify: `docs/product.md`
- Modify: `docs/data-model.md`
- Modify: `docs/permissions.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/operations.md`
- Modify: `docs/testing.md`
- Modify: `docs/traceability.md`

**Interfaces:**
- Consumes: all new attachment table metadata and UI flows.
- Produces: manifest coverage, integrity classifications, browser acceptance, and aligned operator guidance.

- [ ] **Step 1: Write failing operations tests**

Create communication and completion images, then prove backup includes only referenced files, restore reproduces rows and bytes, checker reports missing/wrong/orphan files for every attachment kind, and repair deletes only confirmed orphans.

- [ ] **Step 2: Run operations RED**

Run: `npm test -- tests/integration/ops/backup-restore.test.ts tests/integration/ops/attachment-check.test.ts`  
Expected: FAIL because snapshot and integrity queries cover only request and developer-question attachments.

- [ ] **Step 3: Extend backup and integrity inventory**

Union all protected attachment tables into one storage-name inventory while preserving exact manifest validation, SHA-256 checks, and orphan-only repair.

- [ ] **Step 4: Add browser acceptance**

Exercise developer pasted public reply, developer pasted clarification, customer pasted reply, optional empty completion, later completion note with image, progress rollback retention, and semantic label colors.

- [ ] **Step 5: Align durable documentation**

Update product, data, permissions, user, operations, testing, and traceability documents. State that public `update` performs a remote complete backup and never transfers local business data.

- [ ] **Step 6: Run focused GREEN**

Run: `npm test -- tests/integration/ops/backup-restore.test.ts tests/integration/ops/attachment-check.test.ts`  
Expected: operations tests pass for all attachment types.

- [ ] **Step 7: Commit**

```bash
git add src/ops tests/integration/ops e2e docs
git commit -m "docs: verify communication attachment operations"
```

### Task 6: Full Verification, Merge, Remote Backup Gate, and Public Release

**Files:**
- Verify only; modify implementation files only for evidenced failures.

**Interfaces:**
- Produces: pushed `main`, retained remote pre-release backup, migrated public service, and post-release evidence.

- [ ] **Step 1: Run the complete local gate**

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm audit
bash -n scripts/deploy-ubuntu.sh
```

Use isolated `DATABASE_PATH`, `UPLOADS_PATH`, `TEMP_UPLOADS_PATH`, and `BACKUP_PATH` for the production build. Expected: every command exits zero.

- [ ] **Step 2: Inspect scope and merge the implementation branch**

Run `git diff --check`, GitNexus change detection, inspect every changed path, then merge into `main` without altering the live local SQLite database.

- [ ] **Step 3: Push `main`**

```bash
git push origin main
```

Expected: local `HEAD` equals `origin/main` and the tracked worktree is clean.

- [ ] **Step 4: Capture remote pre-release state**

Use SSH to record container status, `/app/data` bind mount, deployed revision, schema version, core table counts, newest existing backup, and attachment integrity before release. Do not print credentials or private content.

- [ ] **Step 5: Execute code-only update with mandatory backup**

```bash
./scripts/deploy-ubuntu.sh update root@47.121.188.131 \
  --origin http://47.121.188.131:13001
```

Expected: remote log shows a successful complete backup before service stop or migration. If that backup is absent or fails, abort and do not continue manually.

- [ ] **Step 6: Verify public service and retained backup**

Confirm deployed revision, bind mount, migration journal, login HTTP 200, attachment integrity, nondecreasing core data counts, and presence of the pre-release backup directory. Smoke-test authenticated communication images and completion notes without deleting existing user data.

