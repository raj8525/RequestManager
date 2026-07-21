"use client";

import { MessageSquareText, Send } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { UserRole } from "@/db/types";
import { AttachmentGallery } from "@/features/attachments/attachment-gallery";
import { ScreenshotInput } from "@/features/attachments/screenshot-input";
import type { PublicRemarkDto } from "@/features/communication/queries";

function idempotencyKey(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `remark-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function displayTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function PublicRemarks({
  role,
  requestId,
  expectedVersion,
  recordStatus,
  remarks,
}: {
  role: UserRole;
  requestId: number;
  expectedVersion: number;
  recordStatus: "ACTIVE" | "PAUSED" | "ARCHIVED";
  remarks: readonly PublicRemarkDto[];
}) {
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const key = useRef(idempotencyKey());

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("expectedVersion", String(expectedVersion));
      form.set("content", content);
      form.set("idempotencyKey", key.current);
      for (const file of files) form.append("attachments", file);
      const response = await fetch(`/api/requests/${requestId}/public-remarks`, {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as { ok: boolean; message?: string };
      if (!result.ok) {
        setError(result.message ?? "备注提交失败，请稍后重试");
        return;
      }
      setContent("");
      setFiles([]);
      key.current = idempotencyKey();
      window.location.reload();
    } catch {
      setError("备注提交失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="detail-section" aria-labelledby="remarks-heading">
      <div className="detail-section__heading">
        <MessageSquareText aria-hidden="true" size={18} />
        <h2 id="remarks-heading">备注</h2>
      </div>
      {remarks.length === 0 ? (
        <p className="section-empty">暂无备注</p>
      ) : (
        <ol className="message-list">
          {remarks.map((remark) => (
            <li key={remark.id} className="message-item">
              <div className="message-item__meta">
                <strong>{remark.author.displayName}</strong>
                <time dateTime={new Date(remark.createdAt).toISOString()}>
                  {displayTime(remark.createdAt)}
                </time>
              </div>
              <p className="plain-text">{remark.content}</p>
              {remark.attachments?.length ? (
                <div className="message-item__attachments">
                  <AttachmentGallery attachments={remark.attachments} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {role === "DEVELOPER" && recordStatus === "ACTIVE" ? (
        <form
          className="inline-compose"
          onSubmit={submit}
          aria-label="添加备注"
          data-screenshot-paste-target="true"
        >
          <label htmlFor="public-remark">添加备注</label>
          <textarea
            id="public-remark"
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
            {pending ? "正在添加" : "添加备注"}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
