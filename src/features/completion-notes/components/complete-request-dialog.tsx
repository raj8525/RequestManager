"use client";

import { CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { AttachmentGallery } from "@/features/attachments/attachment-gallery";
import { ScreenshotInput } from "@/features/attachments/screenshot-input";
import type { CompletionNoteDto } from "@/features/completion-notes/queries";

export function CompleteRequestDialog({
  open,
  requestId,
  expectedVersion,
  onCancel,
  onCompleted,
}: {
  open: boolean;
  requestId: number;
  expectedVersion: number;
  onCancel: () => void;
  onCompleted: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState("");
  const [retained, setRetained] = useState<CompletionNoteDto["attachments"]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch(`/api/requests/${requestId}/completion`, { cache: "no-store" })
      .then(async (response) => (await response.json()) as { ok: boolean; data?: CompletionNoteDto | null; message?: string })
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setError(result.message ?? "无法读取已有完成说明");
          return;
        }
        setContent(result.data?.content ?? "");
        setRetained(result.data?.attachments ?? []);
        setFiles([]);
        requestAnimationFrame(() => textareaRef.current?.focus());
      })
      .catch(() => active && setError("无法读取已有完成说明"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [open, requestId]);

  if (!open) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || loading) return;
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("expectedVersion", String(expectedVersion));
      form.set("content", content);
      form.set("completeRequest", "true");
      for (const attachment of retained) {
        form.append("retainedAttachmentIds", String(attachment.id));
      }
      for (const file of files) form.append("attachments", file);
      const response = await fetch(`/api/requests/${requestId}/completion`, {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as { ok: boolean; message?: string };
      if (!result.ok) {
        setError(result.message ?? "设置完成失败，请稍后重试");
        return;
      }
      onCompleted();
    } catch {
      setError("设置完成失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onCancel();
    }}>
      <form
        className="completion-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="completion-dialog-title"
        onSubmit={submit}
        data-screenshot-paste-target="true"
      >
        <div className="completion-dialog__heading">
          <CheckCircle2 aria-hidden="true" size={22} />
          <div>
            <h2 id="completion-dialog-title">将需求设为完成</h2>
            <p>完成说明可选，现在不填写也可以之后补充。</p>
          </div>
        </div>
        <label htmlFor={`complete-request-${requestId}`}>完成说明（可选）</label>
        <textarea
          ref={textareaRef}
          id={`complete-request-${requestId}`}
          rows={4}
          maxLength={10_000}
          value={content}
          disabled={pending || loading}
          onChange={(event) => setContent(event.currentTarget.value)}
        />
        {retained.length ? (
          <AttachmentGallery
            attachments={retained}
            disabled={pending}
            onRemove={(attachmentId) =>
              setRetained((items) => items.filter((item) => item.id !== attachmentId))
            }
          />
        ) : null}
        <ScreenshotInput
          value={files}
          onChange={setFiles}
          disabled={pending || loading}
          existingCount={retained.length}
          existingSizeBytes={retained.reduce((total, item) => total + item.sizeBytes, 0)}
        />
        {error ? <p className="field__error" role="alert">{error}</p> : null}
        <div className="completion-dialog__actions">
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" disabled={pending || loading || Boolean(error && loading)}>
            {pending ? "正在完成" : loading ? "正在读取" : "确认完成"}
          </Button>
        </div>
      </form>
    </div>
  );
}
