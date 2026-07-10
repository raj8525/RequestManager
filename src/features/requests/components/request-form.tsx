"use client";

import { Save, Send } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, fieldDescriptionIds } from "@/components/ui/field";
import { AttachmentGallery } from "@/features/attachments/attachment-gallery";
import type { AttachmentDto } from "@/features/attachments/service";
import { ScreenshotInput } from "@/features/attachments/screenshot-input";
import type { RequestDto } from "@/features/requests/presenter";

export type RequestProjectOption = {
  id: number;
  code: string;
  name: string;
};

type RequestApiFailure = {
  ok: false;
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

type RequestApiSuccess = {
  ok: true;
  data: { requestNumber: string };
};

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function firstFieldErrors(
  errors: Record<string, string[]> | undefined,
): Record<string, string> {
  if (!errors) return {};
  return Object.fromEntries(
    Object.entries(errors).flatMap(([key, messages]) =>
      messages[0] ? [[key, messages[0]]] : [],
    ),
  );
}

export function RequestForm({
  mode,
  projects,
  initialRequest,
  initialAttachments = [],
}: {
  mode: "create" | "edit";
  projects: readonly RequestProjectOption[];
  initialRequest?: RequestDto;
  initialAttachments?: readonly AttachmentDto[];
}) {
  const [projectId, setProjectId] = useState(
    String(initialRequest?.projectId ?? projects[0]?.id ?? ""),
  );
  const [content, setContent] = useState(initialRequest?.content ?? "");
  const [requestType, setRequestType] = useState(
    initialRequest?.requestType ?? "BUG",
  );
  const [priority, setPriority] = useState(initialRequest?.priority ?? "NORMAL");
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [retainedAttachments, setRetainedAttachments] = useState([
    ...initialAttachments,
  ]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const idempotencyKey = useRef(createIdempotencyKey());

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || projects.length === 0) return;
    setIsPending(true);
    setFieldErrors({});
    setFormError(null);

    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("content", content);
    formData.set("requestType", requestType);
    formData.set("priority", priority);
    if (mode === "create") {
      formData.set("idempotencyKey", idempotencyKey.current);
    } else if (initialRequest) {
      formData.set("expectedVersion", String(initialRequest.version));
      for (const attachment of retainedAttachments) {
        formData.append("retainedAttachmentIds", String(attachment.id));
      }
    }
    for (const file of newFiles) formData.append("attachments", file, file.name);

    try {
      const endpoint =
        mode === "create"
          ? "/api/requests"
          : `/api/requests/${initialRequest?.requestNumber ?? ""}`;
      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PUT",
        body: formData,
      });
      const result = (await response.json()) as RequestApiSuccess | RequestApiFailure;
      if (!result.ok) {
        setFormError(result.message);
        setFieldErrors(firstFieldErrors(result.fieldErrors));
        return;
      }
      window.location.assign(`/requests/${result.data.requestNumber}`);
    } catch {
      setFormError("提交失败，请检查网络后重试。已填写的内容仍保留在页面中。");
    } finally {
      setIsPending(false);
    }
  }

  const contentError = fieldErrors.content;
  const attachmentError = fieldErrors.attachments;
  const formLabel = mode === "create" ? "新建需求" : "编辑需求";

  return (
    <form aria-label={formLabel} className="request-form" onSubmit={handleSubmit}>
      {formError ? (
        <div className="form-alert form-alert--error" role="alert">
          {formError}
        </div>
      ) : null}
      {projects.length === 0 ? (
        <div className="form-alert" role="status">
          当前没有可提交需求的启用项目，请联系开发者。
        </div>
      ) : null}

      <div className="form-grid form-grid--three">
        <Field label="项目" htmlFor="projectId" error={fieldErrors.projectId} required>
          <select
            id="projectId"
            aria-label="项目"
            value={projectId}
            disabled={mode === "edit" || projects.length === 0 || isPending}
            aria-invalid={fieldErrors.projectId ? true : undefined}
            aria-describedby={fieldDescriptionIds("projectId", {
              error: Boolean(fieldErrors.projectId),
            })}
            onChange={(event) => setProjectId(event.currentTarget.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="需求类型" htmlFor="requestType" error={fieldErrors.requestType} required>
          <select
            id="requestType"
            aria-label="需求类型"
            value={requestType}
            disabled={isPending}
            aria-invalid={fieldErrors.requestType ? true : undefined}
            aria-describedby={fieldDescriptionIds("requestType", {
              error: Boolean(fieldErrors.requestType),
            })}
            onChange={(event) =>
              setRequestType(
                event.currentTarget.value as "BUG" | "CHANGE" | "NEW_FEATURE",
              )
            }
          >
            <option value="BUG">Bug</option>
            <option value="CHANGE">功能变更</option>
            <option value="NEW_FEATURE">新增功能</option>
          </select>
        </Field>
        <Field label="优先级" htmlFor="priority" error={fieldErrors.priority} required>
          <select
            id="priority"
            aria-label="优先级"
            value={priority}
            disabled={isPending}
            aria-invalid={fieldErrors.priority ? true : undefined}
            aria-describedby={fieldDescriptionIds("priority", {
              error: Boolean(fieldErrors.priority),
            })}
            onChange={(event) =>
              setPriority(
                event.currentTarget.value as "URGENT" | "IMPORTANT" | "NORMAL",
              )
            }
          >
            <option value="URGENT">加急</option>
            <option value="IMPORTANT">重要</option>
            <option value="NORMAL">普通</option>
          </select>
        </Field>
      </div>

      <Field
        label="需求内容"
        htmlFor="content"
        hint="请描述现象、期望结果和必要的复现步骤，至少 10 个字符。"
        error={contentError}
        required
      >
        <textarea
          id="content"
          aria-label="需求内容"
          name="content"
          rows={9}
          maxLength={10_000}
          required
          data-screenshot-paste-target="true"
          value={content}
          disabled={isPending}
          aria-invalid={contentError ? true : undefined}
          aria-describedby={fieldDescriptionIds("content", {
            hint: true,
            error: Boolean(contentError),
          })}
          onChange={(event) => setContent(event.currentTarget.value)}
        />
      </Field>

      {mode === "edit" && retainedAttachments.length > 0 ? (
        <div className="field">
          <span className="field__label">已有截图</span>
          <AttachmentGallery
            attachments={retainedAttachments}
            disabled={isPending}
            onRemove={(attachmentId) =>
              setRetainedAttachments((current) =>
                current.filter((attachment) => attachment.id !== attachmentId),
              )
            }
          />
        </div>
      ) : null}

      <div className="field">
        <span className="field__label">
          {mode === "create" ? "截图" : "补充截图"}
        </span>
        <ScreenshotInput
          value={newFiles}
          existingCount={retainedAttachments.length}
          existingSizeBytes={retainedAttachments.reduce(
            (total, attachment) => total + attachment.sizeBytes,
            0,
          )}
          onChange={setNewFiles}
          disabled={isPending}
        />
        {attachmentError ? (
          <p className="field__error" role="alert">
            {attachmentError}
          </p>
        ) : null}
      </div>

      <div className="form-actions">
        <Button
          type="submit"
          disabled={isPending || projects.length === 0}
        >
          {mode === "create" ? (
            <Send aria-hidden="true" size={17} />
          ) : (
            <Save aria-hidden="true" size={17} />
          )}
          {isPending
            ? "正在提交"
            : mode === "create"
              ? "提交需求"
              : "保存修改"}
        </Button>
      </div>
    </form>
  );
}
