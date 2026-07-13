# 需求追踪矩阵

| 编号 | 已批准需求 | 主要实现 | 自动化证据 |
| --- | --- | --- | --- |
| `AUTH-01` | 两种角色、用户名密码登录、七天会话 | `src/auth`、`src/app/(auth)` | `tests/integration/auth`、`e2e/auth.spec.ts` |
| `AUTH-02` | 客户只能改本人密码，用户名由开发者管理 | `src/auth/actions.ts`、`src/features/accounts` | `tests/integration/auth`、`tests/integration/accounts` |
| `AUTH-03` | 强制改密、停用/重置/改密撤销会话 | `src/app/(password)`、`src/auth/session-service.ts` | `tests/integration/auth`、`e2e/auth.spec.ts` |
| `PROJ-01` | 开发者管理项目和客户项目分配 | `src/features/projects`、`src/features/accounts` | `tests/integration/projects`、`tests/integration/accounts` |
| `PROJ-02` | 项目停用保留历史并阻止客户写入 | `src/features/projects/authorization.ts`、领域服务 | `tests/integration/projects`、`tests/integration/requests` |
| `REQ-01` | 客户提交必填正文、类型、优先级 | `src/features/requests`、`src/app/api/requests` | `tests/integration/requests`、`e2e/request-lifecycle.spec.ts` |
| `REQ-02` | 客户查看所属项目全部需求和提交人 | `src/features/requests/queries.ts` | `tests/unit/requests/sorting.test.ts`、`e2e/access-control.spec.ts` |
| `REQ-03` | 本人正常未排期可编辑，已排期可暂停并另提新需求 | `src/features/requests/policy.ts`、`service.ts` | `tests/unit/requests/policy.test.ts`、`tests/integration/requests` |
| `STATE-01` | 进度仅未排期、已排期、完成 | `src/db/schema.ts`、`src/features/requests/service.ts` | `tests/integration/requests`、`e2e/request-lifecycle.spec.ts` |
| `STATE-02` | 记录状态正常、已暂停、已归档及恢复规则 | `src/features/requests/policy.ts`、`service.ts` | `tests/unit/requests/policy.test.ts`、`e2e/request-lifecycle.spec.ts` |
| `COMM-01` | 客户可见公开备注 | `src/features/communication/components/public-remarks.tsx`、`service.ts` | `tests/integration/communication`、`e2e/request-lifecycle.spec.ts` |
| `COMM-02` | 每位开发者一份仅本人可见私人笔记 | `src/features/communication/queries.ts`、`private-note-editor.tsx` | `tests/integration/communication`、`e2e/private-notes.spec.ts` |
| `COMM-03` | 提问标红置顶、回复清除、再次提问重现 | `src/features/communication`、客户排序查询 | `tests/integration/communication`、`e2e/request-lifecycle.spec.ts` |
| `COMM-04` | 公开操作历史 | `request_events`、`request-history.tsx` | `tests/integration/requests/request-events.test.ts`、`tests/components/request-history.test.tsx` |
| `ATT-01` | 选择、拖放、粘贴、预览和移除截图 | `src/features/attachments/screenshot-input.tsx` | `tests/components/screenshot-input.test.tsx`、`e2e/request-lifecycle.spec.ts` |
| `ATT-02` | 文件类型、大小、数量、总量和魔数验证 | `src/features/attachments/validation.ts` | `tests/unit/attachments`、`tests/integration/attachments` |
| `ATT-03` | 截图不在 public，按会话和项目鉴权 | `src/app/api/attachments`、`authorization.ts` | `tests/integration/attachments`、`e2e/access-control.spec.ts` |
| `OPS-01` | 显式迁移和首开发者初始化 | `src/db/migrate.ts`、`src/ops/bootstrap.ts`、`scripts` | `tests/integration/ops/bootstrap.test.ts` |
| `OPS-02` | 一致性备份、停服恢复、迁移兼容和进程锁 | `src/ops/backup.ts`、`manifest.ts`、`process-lock.ts` | `tests/integration/ops/backup-restore.test.ts`、`tests/unit/ops` |
| `OPS-03` | 截图只读检查和仅孤儿修复 | `src/ops/attachment-integrity.ts` | `tests/integration/ops/attachment-check.test.ts` |
| `OPS-04` | Ubuntu 从 GitHub 一键 Docker 部署、升级前备份和失败回滚 | `Dockerfile`、`scripts/deploy-ubuntu.sh` | `tests/deployment/container-contract.test.ts`、`deploy-ubuntu.test.ts`、真实 Docker 烟测 |
| `OPS-05` | SQLite、截图和校验清单完整上传，远端保护备份与原子恢复 | `scripts/deploy-ubuntu.sh`、`src/ops/backup.ts` | `tests/deployment/deploy-ubuntu.test.ts`、`tests/integration/ops/backup-restore.test.ts` |
| `UX-01` | 中文、紧凑、桌面/移动响应式、无颜色单一提示 | `src/app/globals.css`、`src/components` | `tests/components`、`e2e/responsive.spec.ts` |
| `UX-02` | 搜索、筛选、稳定排序、分页 | `request-toolbar.tsx`、`queries.ts`、`pagination.tsx` | `tests/unit/requests/sorting.test.ts`、`tests/components/pagination.test.tsx` |
| `SEC-01` | 服务端权限、同源、IDOR 防护 | `src/auth`、各领域服务和 API | `tests/unit/lib/csrf.test.ts`、`e2e/access-control.spec.ts` |

批准规格：`docs/superpowers/specs/2026-07-10-request-manager-design.md`。实施步骤和门禁：`docs/superpowers/plans/2026-07-10-request-manager-implementation.md`。
