"use client";

import { RotateCcw } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ScreenshotInput } from "@/features/attachments/screenshot-input";

function createIdempotencyKey(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `reopen-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ReopenRequestDialog({
  open,
  requestId,
  expectedVersion,
  onCancel,
  onReopened,
}: {
  open: boolean;
  requestId: number;
  expectedVersion: number;
  onCancel: () => void;
  onReopened: () => void;
}) {
  const key = useRef(createIdempotencyKey());
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !reason.trim()) return;
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("expectedVersion", String(expectedVersion));
      form.set("reason", reason);
      form.set("idempotencyKey", key.current);
      for (const file of files) form.append("attachments", file);
      const response = await fetch(`/api/requests/${requestId}/reopen`, {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
      };
      if (!result.ok) {
        setError(result.message ?? "重新打开失败，请刷新后重试");
        return;
      }
      onReopened();
    } catch {
      setError("重新打开失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <form
        className="completion-dialog reopen-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`reopen-dialog-title-${requestId}`}
        onSubmit={submit}
        data-screenshot-paste-target="true"
      >
        <div className="completion-dialog__heading">
          <RotateCcw aria-hidden="true" size={22} />
          <div>
            <h2 id={`reopen-dialog-title-${requestId}`}>重新打开这条需求</h2>
            <p>
              重新打开后，需求将回到“未排期”，等待开发者重新评估。原完成说明和截图会继续保留。
            </p>
          </div>
        </div>
        <label htmlFor={`reopen-reason-${requestId}`}>重新打开原因</label>
        <textarea
          id={`reopen-reason-${requestId}`}
          rows={4}
          maxLength={10_000}
          required
          value={reason}
          disabled={pending}
          onChange={(event) => setReason(event.currentTarget.value)}
          autoFocus
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
        <div className="completion-dialog__actions">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button type="submit" disabled={pending || !reason.trim()}>
            {pending ? "正在重新打开" : "确认重新打开"}
          </Button>
        </div>
      </form>
    </div>
  );
}
