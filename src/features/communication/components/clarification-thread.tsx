"use client";

import { CircleHelp, Send } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { UserRole } from "@/db/types";
import { AttachmentGallery } from "@/features/attachments/attachment-gallery";
import { ScreenshotInput } from "@/features/attachments/screenshot-input";
import type { ClarificationMessageDto } from "@/features/communication/queries";

function idempotencyKey(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `clarification-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function displayTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ClarificationThread({
  role,
  requestId,
  expectedVersion,
  recordStatus,
  needsCustomerReply,
  messages,
}: {
  role: UserRole;
  requestId: number;
  expectedVersion: number;
  recordStatus: "ACTIVE" | "PAUSED" | "ARCHIVED";
  needsCustomerReply: boolean;
  messages: readonly ClarificationMessageDto[];
}) {
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const key = useRef(idempotencyKey());
  const canCompose =
    recordStatus === "ACTIVE" &&
    (role === "DEVELOPER" || (role === "CUSTOMER" && needsCustomerReply));

  if (messages.length === 0 && !canCompose) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim() || pending || !canCompose) return;
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("expectedVersion", String(expectedVersion));
      form.set("content", content);
      form.set("idempotencyKey", key.current);
      for (const file of files) form.append("attachments", file);
      const response = await fetch(`/api/requests/${requestId}/clarifications`, {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as { ok: boolean; message?: string };
      if (!result.ok) {
        setError(result.message ?? "消息提交失败，请稍后重试");
        return;
      }
      setContent("");
      setFiles([]);
      key.current = idempotencyKey();
      window.location.reload();
    } catch {
      setError("消息提交失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className={
        messages.length > 0
          ? "detail-section detail-section--clarification-has-content"
          : "detail-section"
      }
      aria-labelledby="clarification-heading"
    >
      <div className="detail-section__heading">
        <CircleHelp aria-hidden="true" size={18} />
        <h2 id="clarification-heading">确认与澄清</h2>
      </div>
      {messages.length === 0 ? (
        <p className="section-empty">暂无澄清记录</p>
      ) : (
        <ol className="message-list message-list--conversation">
          {messages.map((message) => (
            <li
              key={message.id}
              className="message-item"
              data-author-role={message.authorRole.toLowerCase()}
            >
              <div className="message-item__meta">
                <strong>{message.author.displayName}</strong>
                <span>{message.authorRole === "DEVELOPER" ? "开发者提问" : "客户回复"}</span>
                <time dateTime={new Date(message.createdAt).toISOString()}>
                  {displayTime(message.createdAt)}
                </time>
              </div>
              <p className="plain-text">{message.content}</p>
              {message.attachments?.length ? (
                <div className="message-item__attachments">
                  <AttachmentGallery attachments={message.attachments} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {canCompose ? (
        <form
          className="inline-compose"
          onSubmit={submit}
          aria-label="澄清消息"
          data-screenshot-paste-target="true"
        >
          <label htmlFor="clarification-message">
            {role === "DEVELOPER" ? "向客户提出问题" : "回复开发者的问题"}
          </label>
          <textarea
            id="clarification-message"
            rows={3}
            maxLength={10_000}
            value={content}
            disabled={pending}
            onChange={(event) => setContent(event.currentTarget.value)}
          />
          <ScreenshotInput
            value={files}
            onChange={setFiles}
            disabled={pending}
          />
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="small" disabled={pending || !content.trim()}>
            <Send aria-hidden="true" size={15} />
            {pending
              ? "正在提交"
              : role === "DEVELOPER"
                ? "提出问题"
                : "提交回复"}
          </Button>
        </form>
      ) : role === "CUSTOMER" && recordStatus === "ACTIVE" ? (
        <p className="section-empty">当前没有需要您回复的问题。</p>
      ) : null}
    </section>
  );
}
