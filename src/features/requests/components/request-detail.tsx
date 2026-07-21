import { CalendarClock, CircleAlert, Images, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { UserRole } from "@/db/types";
import { AttachmentGallery } from "@/features/attachments/attachment-gallery";
import type { AttachmentDto } from "@/features/attachments/service";
import { ClarificationThread } from "@/features/communication/components/clarification-thread";
import { PrivateNoteEditor } from "@/features/communication/components/private-note-editor";
import { PublicRemarks } from "@/features/communication/components/public-remarks";
import type {
  ClarificationMessageDto,
  PrivateNoteDto,
  PublicRemarkDto,
} from "@/features/communication/queries";
import { CompletionNoteEditor } from "@/features/completion-notes/components/completion-note-editor";
import type { CompletionNoteDto } from "@/features/completion-notes/queries";
import { RequestActions } from "@/features/requests/components/request-actions";
import { RequestHistory } from "@/features/requests/components/request-history";
import type { RequestViewDto } from "@/features/requests/presenter";
import { progressBadgeTone } from "@/features/requests/progress-badge-tone";
import type { RequestHistoryEventDto } from "@/features/requests/queries";

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

function fullTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function RequestDetail({
  actor,
  request,
  attachments,
  remarks,
  clarifications,
  privateNote,
  completionNote = null,
  events,
}: {
  actor: { id: number; role: UserRole };
  request: RequestViewDto;
  attachments: readonly AttachmentDto[];
  remarks: readonly PublicRemarkDto[];
  clarifications: readonly ClarificationMessageDto[];
  privateNote?: PrivateNoteDto | null;
  completionNote?: CompletionNoteDto | null;
  events: readonly RequestHistoryEventDto[];
}) {
  return (
    <div className="request-detail">
      {request.needsCustomerReply ? (
        <div className="attention-banner" role="status">
          <CircleAlert aria-hidden="true" size={18} />
          <strong>
            {actor.role === "CUSTOMER" ? "这条需求正在等待您的回复" : "正在等待客户回复"}
          </strong>
          {actor.role === "CUSTOMER" ? <span>请在下方“确认与澄清”中答复。</span> : null}
        </div>
      ) : null}

      <section className="request-overview" aria-labelledby="request-content-heading">
        <div className="request-overview__topline">
          <div className="request-statuses" aria-label="需求状态">
            <Badge>{typeLabels[request.requestType]}</Badge>
            <Badge
              tone={
                request.priority === "URGENT"
                  ? "danger"
                  : request.priority === "IMPORTANT"
                    ? "warning"
                    : "neutral"
              }
            >
              {priorityLabels[request.priority]}
            </Badge>
            <Badge tone={progressBadgeTone(request.progressStatus)}>
              {progressLabels[request.progressStatus]}
            </Badge>
            <Badge tone={request.recordStatus === "ACTIVE" ? "neutral" : "warning"}>
              {recordLabels[request.recordStatus]}
            </Badge>
          </div>
          <RequestActions actor={actor} request={request} />
        </div>
        <h2 className="request-title" id="request-content-heading">
          {request.title ?? "待补充标题"}
        </h2>
        <p className="request-content plain-text">{request.content}</p>
        <dl className="request-meta">
          <div>
            <dt><UserRound aria-hidden="true" size={15} />提交人</dt>
            <dd>{request.createdBy.displayName}</dd>
          </div>
          <div>
            <dt>项目</dt>
            <dd>{request.project.code} · {request.project.name}</dd>
          </div>
          <div>
            <dt><CalendarClock aria-hidden="true" size={15} />创建时间</dt>
            <dd><time dateTime={new Date(request.createdAt).toISOString()}>{fullTime(request.createdAt)}</time></dd>
          </div>
          <div>
            <dt>最后更新</dt>
            <dd><time dateTime={new Date(request.updatedAt).toISOString()}>{fullTime(request.updatedAt)}</time></dd>
          </div>
        </dl>
      </section>

      <section className="detail-section" aria-labelledby="attachments-heading">
        <div className="detail-section__heading">
          <Images aria-hidden="true" size={18} />
          <h2 id="attachments-heading">截图</h2>
          <span>{attachments.length} 张</span>
        </div>
        <AttachmentGallery attachments={attachments} />
      </section>

      <PublicRemarks
        role={actor.role}
        requestId={request.id}
        expectedVersion={request.version}
        recordStatus={request.recordStatus}
        remarks={remarks}
      />
      <ClarificationThread
        role={actor.role}
        requestId={request.id}
        expectedVersion={request.version}
        recordStatus={request.recordStatus}
        needsCustomerReply={request.needsCustomerReply}
        messages={clarifications}
      />
      <CompletionNoteEditor
        role={actor.role}
        requestId={request.id}
        expectedVersion={request.version}
        recordStatus={request.recordStatus}
        note={completionNote}
      />
      {actor.role === "DEVELOPER" ? (
        <PrivateNoteEditor
          requestId={request.id}
          expectedVersion={request.version}
          recordStatus={request.recordStatus}
          note={privateNote}
        />
      ) : null}
      <RequestHistory events={events} />
    </div>
  );
}
