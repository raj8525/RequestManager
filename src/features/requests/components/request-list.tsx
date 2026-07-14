import { ArrowDown, ArrowUp, ArrowUpDown, CircleAlert } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { UserRole } from "@/db/types";
import { RequestActions } from "@/features/requests/components/request-actions";
import type { RequestViewDto } from "@/features/requests/presenter";
import type {
  RequestSortDirection,
  RequestSortField,
} from "@/features/requests/schemas";

const typeLabels = {
  BUG: "Bug",
  CHANGE: "功能变更",
  NEW_FEATURE: "新增功能",
} as const;
const priorityLabels = {
  URGENT: "加急",
  IMPORTANT: "重要",
  NORMAL: "普通",
} as const;
const progressLabels = {
  UNSCHEDULED: "未排期",
  SCHEDULED: "已排期",
  COMPLETED: "完成",
} as const;
const recordLabels = {
  ACTIVE: "正常",
  PAUSED: "已暂停",
  ARCHIVED: "已归档",
} as const;

function formatUpdatedAt(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const defaultDirections: Record<RequestSortField, RequestSortDirection> = {
  requestNumber: "asc",
  project: "asc",
  createdBy: "asc",
  requestType: "asc",
  priority: "asc",
  progressStatus: "asc",
  recordStatus: "asc",
  updatedAt: "desc",
};

function sortHref(
  field: RequestSortField,
  currentSort: RequestSortField | undefined,
  currentDirection: RequestSortDirection | undefined,
  searchParams: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value && !["page", "sort", "direction"].includes(key)) params.set(key, value);
  }
  const direction = currentSort === field
    ? currentDirection === "asc" ? "desc" : "asc"
    : defaultDirections[field];
  params.set("sort", field);
  params.set("direction", direction);
  return `/requests?${params.toString()}`;
}

function SortableHeader({
  field,
  label,
  sort,
  direction,
  searchParams,
}: {
  field: RequestSortField;
  label: string;
  sort?: RequestSortField;
  direction?: RequestSortDirection;
  searchParams: Record<string, string | undefined>;
}) {
  const active = sort === field;
  const resolvedDirection = active ? direction ?? defaultDirections[field] : undefined;
  return (
    <th aria-sort={active ? resolvedDirection === "asc" ? "ascending" : "descending" : undefined}>
      <Link
        href={sortHref(field, sort, resolvedDirection, searchParams)}
        className="request-table__sort"
        title={`按${label}排序`}
      >
        <span>{label}</span>
        {active ? resolvedDirection === "asc"
          ? <ArrowUp aria-hidden="true" size={14} />
          : <ArrowDown aria-hidden="true" size={14} />
          : <ArrowUpDown aria-hidden="true" size={14} />}
      </Link>
    </th>
  );
}

export function RequestList({
  role,
  actorId,
  items,
  sort,
  direction,
  searchParams = {},
}: {
  role: UserRole;
  actorId?: number;
  items: readonly RequestViewDto[];
  sort?: RequestSortField;
  direction?: RequestSortDirection;
  searchParams?: Record<string, string | undefined>;
}) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">没有找到符合条件的需求</p>
        <p>调整搜索或筛选条件后再试。</p>
      </div>
    );
  }

  return (
    <div className="request-table-wrap">
      <table className="request-table">
        <thead>
          <tr>
            <SortableHeader field="requestNumber" label="编号与需求" sort={sort} direction={direction} searchParams={searchParams} />
            <SortableHeader field="project" label="项目" sort={sort} direction={direction} searchParams={searchParams} />
            <SortableHeader field="createdBy" label="提交人" sort={sort} direction={direction} searchParams={searchParams} />
            <SortableHeader field="requestType" label="类型" sort={sort} direction={direction} searchParams={searchParams} />
            <SortableHeader field="priority" label="优先级" sort={sort} direction={direction} searchParams={searchParams} />
            <SortableHeader field="progressStatus" label="进度" sort={sort} direction={direction} searchParams={searchParams} />
            <SortableHeader field="recordStatus" label="记录" sort={sort} direction={direction} searchParams={searchParams} />
            <SortableHeader field="updatedAt" label="更新时间" sort={sort} direction={direction} searchParams={searchParams} />
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const attention = item.needsCustomerReply;
            return (
              <tr
                key={item.id}
                data-testid={`request-row-${item.requestNumber}`}
                data-attention={
                  attention
                    ? role === "CUSTOMER"
                      ? "customer-reply"
                      : "developer-waiting"
                    : undefined
                }
              >
                <td className="request-table__primary" data-label="需求">
                  <div className="request-table__number-line">
                    <Link href={`/requests/${item.requestNumber}`}>
                      {item.requestNumber}
                    </Link>
                    {attention ? (
                      <span className="request-attention">
                        <CircleAlert aria-hidden="true" size={14} />
                        {role === "CUSTOMER" ? "待您回复" : "待客户回复"}
                      </span>
                    ) : null}
                  </div>
                  <Link
                    href={`/requests/${item.requestNumber}`}
                    className="request-table__summary"
                  >
                    {item.summary}
                  </Link>
                </td>
                <td data-label="项目">{item.project.name}</td>
                <td data-label="提交人">{item.createdBy.displayName}</td>
                <td data-label="类型">
                  <Badge>{typeLabels[item.requestType]}</Badge>
                </td>
                <td data-label="优先级">
                  <Badge
                    tone={
                      item.priority === "URGENT"
                        ? "danger"
                        : item.priority === "IMPORTANT"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {priorityLabels[item.priority]}
                  </Badge>
                </td>
                <td data-label="进度">
                  <Badge
                    tone={item.progressStatus === "COMPLETED" ? "success" : "info"}
                  >
                    {progressLabels[item.progressStatus]}
                  </Badge>
                </td>
                <td data-label="记录">
                  <Badge tone={item.recordStatus === "ACTIVE" ? "neutral" : "warning"}>
                    {recordLabels[item.recordStatus]}
                  </Badge>
                </td>
                <td data-label="更新" className="request-table__date">
                  <time dateTime={new Date(item.updatedAt).toISOString()}>
                    {formatUpdatedAt(item.updatedAt)}
                  </time>
                </td>
                <td data-label="操作" className="request-table__actions">
                  {actorId ? (
                    <RequestActions
                      actor={{ id: actorId, role }}
                      request={item}
                      compact
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
