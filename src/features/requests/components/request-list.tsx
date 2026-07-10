import { CircleAlert } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { UserRole } from "@/db/types";
import { RequestActions } from "@/features/requests/components/request-actions";
import type { RequestViewDto } from "@/features/requests/presenter";

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

export function RequestList({
  role,
  actorId,
  items,
}: {
  role: UserRole;
  actorId?: number;
  items: readonly RequestViewDto[];
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
            <th>编号与需求</th>
            <th>项目</th>
            <th>提交人</th>
            <th>类型</th>
            <th>优先级</th>
            <th>进度</th>
            <th>记录</th>
            <th>更新时间</th>
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
                  {actorId ? (
                    <RequestActions
                      actor={{ id: actorId, role }}
                      request={item}
                      compact
                    />
                  ) : null}
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
