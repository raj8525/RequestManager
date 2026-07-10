import { History } from "lucide-react";

import type { RequestHistoryEventDto } from "@/features/requests/queries";

const eventLabels: Record<RequestHistoryEventDto["eventType"], string> = {
  REQUEST_CREATED: "创建了需求",
  REQUEST_UPDATED: "更新了需求内容",
  PROGRESS_CHANGED: "更新了进度",
  REQUEST_PAUSED: "暂停了需求",
  REQUEST_RESUMED: "恢复了需求",
  REQUEST_ARCHIVED: "归档了需求",
  REQUEST_RESTORED: "恢复了归档需求",
  ATTACHMENT_ADDED: "添加了截图",
  ATTACHMENT_REMOVED: "移除了截图",
  PUBLIC_REMARK_ADDED: "添加了客户可见备注",
  CLARIFICATION_ASKED: "提出了澄清问题",
  CLARIFICATION_REPLIED: "回复了澄清问题",
};

const statusLabels = {
  UNSCHEDULED: "未排期",
  SCHEDULED: "已排期",
  COMPLETED: "完成",
  ACTIVE: "正常",
  PAUSED: "已暂停",
  ARCHIVED: "已归档",
} as const;

function displayTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function RequestHistory({
  events,
}: {
  events: readonly RequestHistoryEventDto[];
}) {
  return (
    <section className="detail-section" aria-labelledby="request-history-heading">
      <div className="detail-section__heading">
        <History aria-hidden="true" size={18} />
        <h2 id="request-history-heading">操作历史</h2>
      </div>
      {events.length === 0 ? (
        <p className="section-empty">暂无操作历史</p>
      ) : (
        <ol className="message-list request-history">
          {events.map((event) => (
            <li className="message-item" key={event.id}>
              <div className="message-item__meta">
                <strong>{eventLabels[event.eventType]}</strong>
                <span>{event.actor?.displayName ?? "系统"}</span>
                <time dateTime={new Date(event.createdAt).toISOString()}>
                  {displayTime(event.createdAt)}
                </time>
              </div>
              {event.change ? (
                <p className="request-history__change">
                  {statusLabels[event.change.from]}改为{statusLabels[event.change.to]}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
