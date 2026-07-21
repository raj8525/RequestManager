"use client";

import { CheckCircle2, Save } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { UserRole } from "@/db/types";
import { AttachmentGallery } from "@/features/attachments/attachment-gallery";
import { ScreenshotInput } from "@/features/attachments/screenshot-input";
import type { CompletionNoteDto } from "@/features/completion-notes/queries";

export function CompletionNoteEditor({
  role,
  requestId,
  expectedVersion,
  recordStatus,
  note,
}: {
  role: UserRole;
  requestId: number;
  expectedVersion: number;
  recordStatus: "ACTIVE" | "PAUSED" | "ARCHIVED";
  note: CompletionNoteDto | null;
}) {
  const [content, setContent] = useState(note?.content ?? "");
  const [retained, setRetained] = useState(note?.attachments ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (role !== "DEVELOPER" && !note) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("expectedVersion", String(expectedVersion));
      form.set("content", content);
      form.set("completeRequest", "false");
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
        setError(result.message ?? "完成说明保存失败，请稍后重试");
        return;
      }
      setFiles([]);
      window.location.reload();
    } catch {
      setError("完成说明保存失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  const canEdit = role === "DEVELOPER" && recordStatus === "ACTIVE";
  return (
    <section className="detail-section" aria-labelledby="completion-note-heading">
      <div className="detail-section__heading">
        <CheckCircle2 aria-hidden="true" size={18} />
        <h2 id="completion-note-heading">完成说明</h2>
        {note ? <span>最后由 {note.updatedBy.displayName} 更新</span> : null}
      </div>
      {canEdit ? (
        <form
          className="inline-compose completion-note-form"
          onSubmit={submit}
          data-screenshot-paste-target="true"
        >
          <label htmlFor="completion-note-content">完成说明（可选）</label>
          <textarea
            id="completion-note-content"
            rows={4}
            maxLength={10_000}
            value={content}
            disabled={pending}
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
            disabled={pending}
            existingCount={retained.length}
            existingSizeBytes={retained.reduce((total, item) => total + item.sizeBytes, 0)}
          />
          {error ? <p className="field__error" role="alert">{error}</p> : null}
          <Button type="submit" size="small" disabled={pending}>
            <Save aria-hidden="true" size={15} />
            {pending ? "正在保存" : "保存完成说明"}
          </Button>
        </form>
      ) : (
        <div className="completion-note-readonly">
          {note?.content ? <p className="plain-text">{note.content}</p> : null}
          {note?.attachments.length ? <AttachmentGallery attachments={note.attachments} /> : null}
        </div>
      )}
    </section>
  );
}
