# Task 9 Implementation Report

Date: 2026-07-10
Baseline: `fc430ae`

## Scope

- Added explicit migration and first-developer commands. Migration emits the
  before/after Drizzle schema versions. Bootstrap validates explicit
  `ADMIN_*` values, creates only when no enabled developer exists, uses an
  immediate transaction, and never logs a password.
- Added a versioned JSON backup manifest with SQLite and attachment sizes and
  SHA-256 digests. Backup performs a WAL checkpoint, uses the
  `better-sqlite3` online backup API, normalizes the snapshot away from WAL,
  copies only attachment rows present in that snapshot, verifies each source
  against its row, builds below `.partial`, verifies the complete file set,
  and atomically renames the completed backup.
- Added stopped restore with both `--confirm-restore` and `--app-stopped`
  acknowledgements. Restore verifies the manifest, every digest, SQLite
  integrity, foreign keys, schema version and exact attachment-row set before
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
