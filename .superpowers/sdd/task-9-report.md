# Task 9 Implementation Report

Date: 2026-07-10
Baseline: `fc430ae`

## Scope

- Added explicit migration and first-developer commands. Migration emits the
  before/after Drizzle schema versions. Bootstrap validates explicit
  `ADMIN_*` values, creates only when no enabled developer exists, uses an
  immediate transaction, and never logs a password.
- Added a versioned JSON backup manifest with SQLite and attachment sizes and
  SHA-256 digests plus the ordered Drizzle migration journal. Backup performs a WAL checkpoint, uses the
  `better-sqlite3` online backup API, normalizes the snapshot away from WAL,
  copies only attachment rows present in that snapshot, verifies each source
  against its row, builds below `.partial`, verifies the complete file set,
  and atomically renames the completed backup.
- Added stopped restore with both `--confirm-restore` and `--app-stopped`
  acknowledgements. Restore verifies the manifest, every digest, SQLite
  integrity, foreign keys, the exact current-code migration hashes/order and
  exact attachment-row set before
  staging beside live paths. It uses rename-based replacement with rollback;
  preflight or staging failure leaves live data unchanged.
- Closed the Task 5 crash-reconciliation gate with an attachment checker that
  reports missing, orphaned, wrong-size and wrong-hash files. Report mode does
  not mutate. `--apply` rechecks and removes only orphan files; missing rows and
  damaged referenced files remain untouched for operator recovery.
- Added path guards for filesystem roots, shared dangerous directories,
  overlapping live/backup paths and symbolic-link storage entries. Added
  single-line structured logging that redacts password, token, body, content,
  private-note and binary fields and prevents callers from overriding the
  event or timestamp.
- Added an E2E seed command that runs only with `NODE_ENV=test`, requires
  explicit E2E paths independent from live paths, and creates the five fixture
  users plus project membership without touching live data.
- Added package scripts and environment/ignore entries for migration,
  bootstrap, backup, confirmed stopped restore, attachment check/repair and
  E2E seed.

## TDD Evidence

Initial RED:

```text
rtk npm test -- tests/integration/ops
# 3 suites failed at import, 0 tests ran
# missing @/ops/paths, @/ops/backup and @/ops/attachment-integrity
```

Additional RED/GREEN regressions covered two self-review findings:

- A caller could originally override structured `event`/`timestamp` fields.
  The regression failed, then passed after reserved fields were written last.
- A referenced storage name placed at the wrong filesystem location was
  reported as orphaned but skipped by repair. The regression failed, then
  passed after canonical-path confirmation was separated from display labels.
- Backup originally accepted a root containing the live database and followed
  a symbolic-link attachment prefix. Both tests failed, then passed after
  overlap and prefix-directory checks were added.

Focused GREEN:

```text
rtk npm test -- tests/integration/ops
# 3 files passed, 13 tests passed
```

The tests explicitly create both a missing attachment row target and an orphan
file, verify default report-only behavior, and prove repair removes only the
orphan while all attachment database rows remain.

## Recovery Rehearsal

The package commands were exercised against the isolated directory
`/tmp/request-manager-task9-rehearsal.mzqwH2`:

1. `db:migrate` reported `beforeVersion: 0` and `afterVersion: 3`.
2. `admin:init` created `admin`; a second run with a changed password exited 1
   with `FIRST_DEVELOPER_INIT_FAILED` and printed neither password.
3. A real request row and protected attachment were inserted, then
   `ops:backup` produced a one-attachment verified snapshot.
4. The live request, attachment and upload set were mutated. Restore without
   acknowledgements exited 1. Confirmed stopped restore exited 0 and recovered
   `original rehearsal request`, `original screenshot bytes`, and removed the
   live-only file.
5. A missing file and canonical orphan were created. The check command reported
   both without deletion. Repair removed the orphan, retained the missing
   condition and left the attachment row count at one.

## Verification

```text
rtk npm test -- tests/integration/ops
# 3 files passed, 13 tests passed

rtk npm test
# 29 files passed, 155 tests passed

rtk npm run typecheck
# exit 0

rtk npm run lint
# exit 0, no warnings

rtk npm run build
# compiled successfully; 11 static pages generated and all dynamic routes emitted
```

## Security Hardening Follow-up

Review of `7b676b5` found six destructive-operations gaps. The follow-up closes
all six:

- E2E seed now checks every pair among E2E database/uploads and live
  database/uploads before any removal, including both previously missing
  cross-pairs.
- Managed paths canonicalize physical ancestors and reject every symbolic-link
  component, so an ancestor alias cannot bypass overlap checks. Backup,
  restore, E2E seed and attachment repair each have a regression test.
- Attachment checking rejects database/uploads overlap before opening or
  scanning either path. Its apply-mode regression proves the database,
  WAL/SHM sentinels and orphan remain untouched.
- Manifest format 2 records each applied migration ordinal, SHA-256 and journal
  timestamp. Verification requires an exact match between manifest, snapshot
  and the migrations shipped with the current application; a same-count fork
  is rejected before touching live data.
- The application runtime and restore now use the same atomic, PID-owned
  process lock. Restore holds it across verification, staging, swap, rollback
  and cleanup. Dead-owner locks are retired atomically; fresh incomplete and
  live-owner locks fail closed.
- Backup publication fsyncs every regular file and directory before rename and
  fsyncs the parent afterward. Restore fsyncs staged data and every rename,
  rollback and cleanup parent-directory boundary.

Follow-up RED:

```text
rtk npm test -- tests/integration/ops tests/unit/ops
# 5 files failed: 3 missing hardening modules and 3 behavioral regressions
# overlap repair deleted database/WAL/SHM; both E2E cross-path cases mutated live paths
```

Follow-up GREEN:

```text
rtk npm test -- tests/integration/ops tests/unit/ops
# 5 files passed, 24 tests passed

rtk npx eslint src/db/migrate.ts src/db/runtime.ts src/ops/... tests/integration/ops tests/unit/ops
# no issues found

rtk npx tsc --noEmit -p <temporary Task 9-only tsconfig>
# no errors found
```

The hardening rehearsal used
`/private/tmp/request-manager-task9-security.BBHfnC`: migration and bootstrap
succeeded, format-2 backup contained all three ordered migration hashes, a
live runtime process blocked restore, and a same-count forked migration journal
was rejected. After live database/attachment mutation, confirmed restore
recovered `original security rehearsal` and `original protected screenshot`
and removed the live-only file. Report-only attachment checking found one
orphan without deletion, repair removed it, and the final check was clean.

Full-project typecheck/build were intentionally deferred to the root task while
the parallel Task 10 agent was adding not-yet-implemented component and event
interfaces in the shared worktree. The focused Task 9 suite and scoped lint are
clean; the root release gate will run the complete matrix after those parallel
changes settle.
