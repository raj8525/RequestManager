"use client";

import { LockKeyhole, Save } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { PrivateNoteDto } from "@/features/communication/queries";
import { savePrivateNoteRuntimeAction } from "@/features/communication/runtime-actions";

export function PrivateNoteEditor({
  requestId,
  expectedVersion,
  recordStatus,
  note,
}: {
  requestId: number;
  expectedVersion: number;
  recordStatus: "ACTIVE" | "PAUSED" | "ARCHIVED";
  note?: PrivateNoteDto | null;
}) {
  const [content, setContent] = useState(note?.content ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim() || pending || recordStatus !== "ACTIVE") return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const result = await savePrivateNoteRuntimeAction({
        requestId,
        expectedVersion,
        content,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(true);
    } catch {
      setError("笔记保存失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="detail-section detail-section--private" aria-labelledby="private-note-heading">
      <div className="detail-section__heading">
        <LockKeyhole aria-hidden="true" size={18} />
        <h2 id="private-note-heading">私人笔记</h2>
        <span>仅您可见</span>
      </div>
      <form className="inline-compose" onSubmit={submit} aria-label="私人笔记">
        <label className="sr-only" htmlFor="private-note">
          私人笔记内容
        </label>
        <textarea
          id="private-note"
          rows={5}
          maxLength={10_000}
          value={content}
          disabled={pending || recordStatus !== "ACTIVE"}
          onChange={(event) => {
            setContent(event.currentTarget.value);
            setSaved(false);
          }}
        />
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : saved ? (
          <p className="form-success" role="status">笔记已保存</p>
        ) : null}
        <Button
          type="submit"
          size="small"
          disabled={pending || recordStatus !== "ACTIVE" || !content.trim()}
        >
          <Save aria-hidden="true" size={15} />
          {pending ? "正在保存" : "保存笔记"}
        </Button>
      </form>
    </section>
  );
}
