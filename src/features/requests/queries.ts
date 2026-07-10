import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { ZodError } from "zod";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  projectMemberships,
  projects,
  requests,
  users,
} from "@/db/schema";
import type { AppDatabase } from "@/db/types";
import {
  actionFailure,
  actionSuccess,
  type ActionFailure,
  type ActionResult,
} from "@/lib/action-result";
import { parseRequestNumber } from "@/lib/request-number";

import {
  presentRequestView,
  type RequestViewDto,
  type RequestViewRow,
} from "./presenter";
import {
  listRequestsSchema,
  requestDetailSchema,
  type ListRequestsInput,
} from "./schemas";

export type RequestListResult = {
  items: RequestViewDto[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

const requestViewSelection = {
  ...getTableColumns(requests),
  projectCode: projects.code,
  projectName: projects.name,
  projectIsActive: projects.isActive,
  creatorDisplayName: users.displayName,
};

function validationErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    const key = typeof field === "string" ? field : "form";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

function invalidInput(error: ZodError): ActionFailure {
  return actionFailure(
    "INVALID_INPUT",
    "查询条件无效",
    validationErrors(error),
  );
}

function getLiveActor(
  database: AppDatabase,
  actor: AuthenticatedUser,
): { ok: true; actor: AuthenticatedUser } | { ok: false; result: ActionFailure } {
  const current = database.db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, actor.id))
    .get();
  if (!current || !current.isActive || current.role !== actor.role) {
    return {
      ok: false,
      result: actionFailure("FORBIDDEN", "无权查看需求"),
    };
  }
  if (current.mustChangePassword) {
    return {
      ok: false,
      result: actionFailure("PASSWORD_CHANGE_REQUIRED", "请先修改密码"),
    };
  }
  return {
    ok: true,
    actor: {
      id: current.id,
      username: current.username,
      displayName: current.displayName,
      role: current.role,
      mustChangePassword: false,
    },
  };
}

function filterConditions(
  filters: ReturnType<typeof listRequestsSchema.parse>,
): SQL[] {
  const conditions: SQL[] = [];
  if (filters.recordStatus) {
    conditions.push(eq(requests.recordStatus, filters.recordStatus));
  } else {
    conditions.push(ne(requests.recordStatus, "ARCHIVED"));
  }
  if (filters.projectId) conditions.push(eq(requests.projectId, filters.projectId));
  if (filters.requestType) {
    conditions.push(eq(requests.requestType, filters.requestType));
  }
  if (filters.priority) conditions.push(eq(requests.priority, filters.priority));
  if (filters.progressStatus) {
    conditions.push(eq(requests.progressStatus, filters.progressStatus));
  }
  if (filters.search) {
    const requestId = parseRequestNumber(filters.search);
    const contentMatch = sql`instr(lower(${requests.content}), lower(${filters.search})) > 0`;
    conditions.push(
      requestId === null
        ? contentMatch
        : (or(eq(requests.id, requestId), contentMatch) as SQL),
    );
  }
  return conditions;
}

const customerSortRank = sql<number>`case
  when ${requests.recordStatus} = 'ACTIVE' and ${requests.needsCustomerReply} = 1 then 0
  when ${requests.recordStatus} = 'ACTIVE' then 1
  when ${requests.recordStatus} = 'PAUSED' then 2
  else 3
end`;

export function getRequestDetail(
  database: AppDatabase,
  actor: AuthenticatedUser,
  requestId: number,
): ActionResult<RequestViewDto> {
  const parsed = requestDetailSchema.safeParse({ requestId });
  if (!parsed.success) return invalidInput(parsed.error);
  const live = getLiveActor(database, actor);
  if (!live.ok) return live.result;

  let row: RequestViewRow | undefined;
  if (live.actor.role === "CUSTOMER") {
    row = database.db
      .select(requestViewSelection)
      .from(requests)
      .innerJoin(
        projectMemberships,
        and(
          eq(projectMemberships.projectId, requests.projectId),
          eq(projectMemberships.customerId, live.actor.id),
        ),
      )
      .innerJoin(projects, eq(projects.id, requests.projectId))
      .innerJoin(users, eq(users.id, requests.createdById))
      .where(eq(requests.id, parsed.data.requestId))
      .get();
  } else {
    row = database.db
      .select(requestViewSelection)
      .from(requests)
      .innerJoin(projects, eq(projects.id, requests.projectId))
      .innerJoin(users, eq(users.id, requests.createdById))
      .where(eq(requests.id, parsed.data.requestId))
      .get();
  }

  return row
    ? actionSuccess(presentRequestView(row))
    : actionFailure("NOT_FOUND", "需求不存在");
}

export function listRequests(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: ListRequestsInput = {},
): ActionResult<RequestListResult> {
  const parsed = listRequestsSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const live = getLiveActor(database, actor);
  if (!live.ok) return live.result;

  const filters = parsed.data;
  const conditions = filterConditions(filters);
  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;
  let rows: RequestViewRow[];
  let total: number;

  if (live.actor.role === "CUSTOMER") {
    rows = database.db
      .select(requestViewSelection)
      .from(requests)
      .innerJoin(
        projectMemberships,
        and(
          eq(projectMemberships.projectId, requests.projectId),
          eq(projectMemberships.customerId, live.actor.id),
        ),
      )
      .innerJoin(projects, eq(projects.id, requests.projectId))
      .innerJoin(users, eq(users.id, requests.createdById))
      .where(where)
      .orderBy(customerSortRank, desc(requests.updatedAt), desc(requests.id))
      .limit(filters.pageSize)
      .offset(offset)
      .all();
    total = database.db
      .select({ value: count() })
      .from(requests)
      .innerJoin(
        projectMemberships,
        and(
          eq(projectMemberships.projectId, requests.projectId),
          eq(projectMemberships.customerId, live.actor.id),
        ),
      )
      .where(where)
      .get()?.value ?? 0;
  } else {
    rows = database.db
      .select(requestViewSelection)
      .from(requests)
      .innerJoin(projects, eq(projects.id, requests.projectId))
      .innerJoin(users, eq(users.id, requests.createdById))
      .where(where)
      .orderBy(desc(requests.updatedAt), desc(requests.id))
      .limit(filters.pageSize)
      .offset(offset)
      .all();
    total = database.db
      .select({ value: count() })
      .from(requests)
      .where(where)
      .get()?.value ?? 0;
  }

  return actionSuccess({
    items: rows.map(presentRequestView),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.ceil(total / filters.pageSize),
  });
}
