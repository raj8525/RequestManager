"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) onCancel();
      }}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending) onCancel();
        }}
      >
        <AlertTriangle aria-hidden="true" size={22} />
        <div>
          <h2 id="confirm-dialog-title">{title}</h2>
          <p id="confirm-dialog-description">{description}</p>
        </div>
        <div className="confirm-dialog__actions">
          <button
            ref={cancelRef}
            type="button"
            className="button button--secondary button--medium"
            disabled={pending}
            onClick={onCancel}
          >
            取消
          </button>
          <Button
            variant={destructive ? "danger" : "primary"}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "正在处理" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
