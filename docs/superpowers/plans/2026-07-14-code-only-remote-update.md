# Remote Code-Only Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable local `update SSH_TARGET` command that uploads and deploys the current Git revision without replacing remote application data.

**Architecture:** Reuse the existing Git bundle, SSH ControlMaster, remote bundle deployment, server backup, migration, rollback, and health-check path. Generalize the local release transport so `sync` opts into a second data-backup upload phase while `update` ends after code deployment.

**Tech Stack:** Bash, Git bundle, OpenSSH, Docker, Vitest, ShellCheck

## Global Constraints

- `update` never runs local `ops:backup` and never invokes remote `__receive-backup`.
- Remote deployment continues to back up existing server data and run safe migrations before health verification.
- Tracked local files must be clean and `HEAD` must already be pushed to `origin`.
- Credentials, runtime data, and temporary transport artifacts must not enter Git.

---

### Task 1: Public command contract

**Files:**
- Modify: `tests/deployment/deploy-ubuntu.test.ts`
- Modify: `scripts/deploy-ubuntu.sh`

**Interfaces:**
- Produces: `command_update` and `update SSH_TARGET [--ssh-port PORT] [--origin URL] [--port PORT]`

- [ ] **Step 1: Write failing tests** asserting help output includes `update SSH_TARGET`, invalid targets are rejected before transport, and `main` routes `update` separately from `sync`.
- [ ] **Step 2: Run** `npm test -- tests/deployment/deploy-ubuntu.test.ts` and confirm failure because `update` is unknown.
- [ ] **Step 3: Add `command_update`** with the same validated remote options as `command_sync`, then add help and `main` routing.
- [ ] **Step 4: Re-run the focused test** and confirm the command contract passes.

### Task 2: Code-only bundle release

**Files:**
- Modify: `tests/deployment/deploy-ubuntu.test.ts`
- Modify: `scripts/deploy-ubuntu.sh`

**Interfaces:**
- Produces: `release_to_server(target, ssh_port, origin, port, replace_data)`; `update` passes `false`, `sync` passes `true`.

- [ ] **Step 1: Write a failing safety-contract test** proving the update branch creates and uploads a Git bundle and calls remote bundle deployment, while local backup creation, backup `scp`, and `__receive-backup` are confined to `replace_data=true`.
- [ ] **Step 2: Run the focused deployment test** and confirm the missing shared release path causes failure.
- [ ] **Step 3: Refactor `sync_to_server` into `release_to_server`** so revision validation, temporary directories, short ControlMaster socket, bundle creation, upload, remote deployment, cleanup, and failure traps are shared. Guard only local backup, destructive confirmation, backup upload, and remote restore behind `replace_data=true`.
- [ ] **Step 4: Add thin `update_to_server` and `sync_to_server` wrappers** and distinct success messages.
- [ ] **Step 5: Run the focused deployment test, `bash -n`, and ShellCheck** and fix all findings.

### Task 3: Documentation and release verification

**Files:**
- Modify: `README.md`
- Modify: `docs/operations.md`
- Modify: `docs/testing.md`
- Modify: `tests/deployment/deploy-ubuntu.test.ts`

**Interfaces:**
- Produces: one documented operator command with an explicit data-preservation boundary.

- [ ] **Step 1: Extend the documentation contract test** to require the same `update root@SERVER_IP` command in README and operations docs.
- [ ] **Step 2: Update documentation** to contrast `update` with `sync` and explain remote backup plus migration semantics.
- [ ] **Step 3: Run** `npm test`, `npm run typecheck`, `npm run lint`, an isolated-database `npm run build`, `npm audit`, Bash syntax checking, and ShellCheck.
- [ ] **Step 4: Commit and push** only the specification, plan, script, tests, and aligned documentation.
- [ ] **Step 5: Execute the public `update` command against `47.121.188.131`** and verify the deployed revision, `/app/data` bind mount, login HTTP 200, attachment integrity, and unchanged counts for `users`, `projects`, `requests`, `attachments`, and `developer_questions`.
