import type { Request } from "@/db/types";
import { formatRequestNumber } from "@/lib/request-number";

export type RequestDto = {
  id: number;
  requestNumber: string;
  projectId: number;
  createdById: number;
  title: string | null;
  content: string;
  summary: string;
  requestType: Request["requestType"];
  priority: Request["priority"];
  progressStatus: Request["progressStatus"];
  recordStatus: Request["recordStatus"];
  needsCustomerReply: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type RequestViewDto = RequestDto & {
  project: {
    id: number;
    code: string;
    name: string;
    isActive: boolean;
  };
  createdBy: {
    id: number;
    displayName: string;
  };
};

export type RequestViewRow = Request & {
  projectCode: string;
  projectName: string;
  projectIsActive: boolean;
  creatorDisplayName: string;
};

export function summarizeRequestContent(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine.length > 0 && firstLine.length <= 60) return firstLine;
  return content.replace(/\s+/g, " ").trim().slice(0, 60);
}

export function presentRequest(request: Request): RequestDto {
  return {
    id: request.id,
    requestNumber: formatRequestNumber(request.id),
    projectId: request.projectId,
    createdById: request.createdById,
    title: request.title,
    content: request.content,
    summary: summarizeRequestContent(request.content),
    requestType: request.requestType,
    priority: request.priority,
    progressStatus: request.progressStatus,
    recordStatus: request.recordStatus,
    needsCustomerReply:
      request.recordStatus === "ACTIVE" && request.needsCustomerReply,
    version: request.version,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export function presentRequestView(request: RequestViewRow): RequestViewDto {
  return {
    ...presentRequest(request),
    project: {
      id: request.projectId,
      code: request.projectCode,
      name: request.projectName,
      isActive: request.projectIsActive,
    },
    createdBy: {
      id: request.createdById,
      displayName: request.creatorDisplayName,
    },
  };
}
