import {
  and,
  asc,
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
  requestEvents,
  requestProgressStatuses,
  requestRecordStatuses,
  requests,
  users,
} from "@/db/schema";
import type {
  AppDatabase,
  RequestEventType,
  RequestProgressStatus,
  RequestRecordStatus,
} from "@/db/types";
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
  type RequestSortDirection,
  type RequestSortField,
} from "./schemas";

export type RequestListResult = {
  items: RequestViewDto[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type RequestHistoryChange = {
  from: RequestProgressStatus | RequestRecordStatus;
  to: RequestProgressStatus | RequestRecordStatus;
};

export type RequestHistoryEventDto = {
  id: number;
  eventType: RequestEventType;
  actor: { id: number; displayName: string } | null;
  change: RequestHistoryChange | null;
  createdAt: Date;
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

function isStatus<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function safeEventChange(
  eventType: RequestEventType,
  payload: Record<string, unknown> | null,
): RequestHistoryChange | null {
  if (!payload) return null;
  if (
    eventType === "PROGRESS_CHANGED" &&
    isStatus(requestProgressStatuses, payload.from) &&
    isStatus(requestProgressStatuses, payload.to)
  ) {
    return { from: payload.from, to: payload.to };
  }
  if (
    [
      "REQUEST_PAUSED",
      "REQUEST_RESUMED",
      "REQUEST_ARCHIVED",
      "REQUEST_RESTORED",
    ].includes(eventType) &&
    isStatus(requestRecordStatuses, payload.from) &&
    isStatus(requestRecordStatuses, payload.to)
  ) {
    return { from: payload.from, to: payload.to };
  }
  return null;
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

const progressSortRank = sql<number>`case ${requests.progressStatus}
  when 'SCHEDULED' then 0
  when 'UNSCHEDULED' then 1
  when 'COMPLETED' then 2
  else 3
end`;
const prioritySortRank = sql<number>`case ${requests.priority}
  when 'URGENT' then 0
  when 'IMPORTANT' then 1
  when 'NORMAL' then 2
  else 3
end`;
const typeSortRank = sql<number>`case ${requests.requestType}
  when 'BUG' then 0
  when 'CHANGE' then 1
  when 'NEW_FEATURE' then 2
  else 3
end`;
const recordSortRank = sql<number>`case ${requests.recordStatus}
  when 'ACTIVE' then 0
  when 'PAUSED' then 1
  when 'ARCHIVED' then 2
  else 3
end`;

function sortExpression(field: RequestSortField): SQL {
  switch (field) {
    case "requestNumber": return sql`${requests.id}`;
    case "project": return sql`lower(${projects.name})`;
    case "createdBy": return sql`lower(${users.displayName})`;
    case "requestType": return typeSortRank;
    case "priority": return prioritySortRank;
    case "progressStatus": return progressSortRank;
    case "recordStatus": return recordSortRank;
    case "updatedAt": return sql`${requests.updatedAt}`;
  }
}

function directed(expression: SQL, direction: RequestSortDirection): SQL {
  return direction === "asc" ? asc(expression) : desc(expression);
}

function requestOrderBy(
  role: AuthenticatedUser["role"],
  filters: ReturnType<typeof listRequestsSchema.parse>,
): SQL[] {
  const prefix = role === "CUSTOMER" ? [customerSortRank] : [];
  if (filters.sort) {
    const direction = filters.direction ?? (filters.sort === "updatedAt" ? "desc" : "asc");
    return [
      ...prefix,
      directed(sortExpression(filters.sort), direction),
      directed(sql`${requests.id}`, direction),
    ];
  }
  return [
    ...prefix,
    progressSortRank,
    prioritySortRank,
    desc(requests.updatedAt),
    desc(requests.id),
  ];
}

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

export function listRequestEvents(
  database: AppDatabase,
  actor: AuthenticatedUser,
  requestId: number,
): ActionResult<RequestHistoryEventDto[]> {
  const access = getRequestDetail(database, actor, requestId);
  if (!access.ok) return access;

  const visibility =
    actor.role === "CUSTOMER"
      ? eq(requestEvents.visibility, "PUBLIC")
      : undefined;
  const rows = database.db
    .select({
      id: requestEvents.id,
      eventType: requestEvents.eventType,
      payload: requestEvents.payload,
      createdAt: requestEvents.createdAt,
      actorId: users.id,
      actorDisplayName: users.displayName,
    })
    .from(requestEvents)
    .leftJoin(users, eq(users.id, requestEvents.actorId))
    .where(and(eq(requestEvents.requestId, requestId), visibility))
    .orderBy(asc(requestEvents.createdAt), asc(requestEvents.id))
    .all();

  return actionSuccess(
    rows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      actor:
        row.actorId === null || row.actorDisplayName === null
          ? null
          : { id: row.actorId, displayName: row.actorDisplayName },
      change: safeEventChange(row.eventType, row.payload),
      createdAt: row.createdAt,
    })),
  );
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
      .orderBy(...requestOrderBy(live.actor.role, filters))
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
      .orderBy(...requestOrderBy(live.actor.role, filters))
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
