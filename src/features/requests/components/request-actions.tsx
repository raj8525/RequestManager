"use client";

import { Archive, CirclePause, Pencil, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { buttonClassName } from "@/components/ui/button";
import type { UserRole } from "@/db/types";
import { CompleteRequestDialog } from "@/features/completion-notes/components/complete-request-dialog";
import type { RequestViewDto } from "@/features/requests/presenter";
import {
  archiveRequestRuntimeAction,
  changeProgressRuntimeAction,
  pauseRequestRuntimeAction,
  restoreRequestRuntimeAction,
  resumeRequestRuntimeAction,
} from "@/features/requests/runtime-actions";

type ConfirmedAction = "pause" | "archive" | null;

export function RequestActions({
  actor,
  request,
  compact = false,
}: {
  actor: { id: number; role: UserRole };
  request: RequestViewDto;
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ConfirmedAction>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const canEdit =
    actor.role === "CUSTOMER" &&
    actor.id === request.createdById &&
    request.recordStatus === "ACTIVE" &&
    request.progressStatus === "UNSCHEDULED" &&
    request.project.isActive;
  const canFillTitle =
    actor.role === "CUSTOMER" &&
    actor.id === request.createdById &&
    request.title === null &&
    request.project.isActive;
  const showEdit =
    actor.role === "CUSTOMER" && actor.id === request.createdById;
  const canCustomerPause =
    actor.role === "CUSTOMER" &&
    actor.id === request.createdById &&
    request.recordStatus === "ACTIVE" &&
    request.progressStatus === "SCHEDULED" &&
    request.project.isActive;

  async function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
  ) {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? "操作失败，请刷新后重试");
        return;
      }
    } catch {
      setError("系统暂时不可用，请稍后重试");
    } finally {
      setPending(false);
      setConfirming(null);
    }
  }

  const lifecycleInput = {
    requestId: request.id,
    expectedVersion: request.version,
  };
  const isDeveloper = actor.role === "DEVELOPER";
  const active = request.recordStatus === "ACTIVE";
  const paused = request.recordStatus === "PAUSED";
  const archived = request.recordStatus === "ARCHIVED";

  if (!isDeveloper && !showEdit && !canCustomerPause) return null;

  return (
    <div className={compact ? "request-actions request-actions--compact" : "request-actions"}>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {canEdit || canFillTitle ? (
        <Link
          href={`/requests/${request.requestNumber}/edit`}
          className={buttonClassName({ variant: "secondary", size: "small" })}
        >
          <Pencil aria-hidden="true" size={15} />
          {canFillTitle ? "补充标题" : "编辑"}
        </Link>
      ) : showEdit ? (
        <button
          type="button"
          className={buttonClassName({ variant: "secondary", size: "small" })}
          disabled
          title="仅正常且未排期的需求可以编辑"
        >
          <Pencil aria-hidden="true" size={15} />
          编辑
        </button>
      ) : null}
      {isDeveloper && active ? (
        <label className="inline-select">
          <span className="sr-only">更新进度</span>
          <select
            aria-label="更新进度"
            value={request.progressStatus}
            disabled={pending}
            onChange={(event) => {
              const progressStatus = event.currentTarget.value as
                | "UNSCHEDULED"
                | "SCHEDULED"
                | "COMPLETED";
              if (progressStatus === request.progressStatus) return;
              if (progressStatus === "COMPLETED") {
                setCompletionOpen(true);
                return;
              }
              void run(() =>
                changeProgressRuntimeAction({
                  ...lifecycleInput,
                  progressStatus,
                }),
              );
            }}
          >
            <option value="UNSCHEDULED">未排期</option>
            <option value="SCHEDULED">已排期</option>
            <option value="COMPLETED">完成</option>
          </select>
        </label>
      ) : null}
      {(canCustomerPause ||
        (isDeveloper && active && request.progressStatus === "SCHEDULED")) ? (
        <button
          type="button"
          className={buttonClassName({ variant: "secondary", size: "small" })}
          disabled={pending}
          onClick={() => setConfirming("pause")}
        >
          <CirclePause aria-hidden="true" size={15} />
          暂停
        </button>
      ) : null}
      {isDeveloper && paused ? (
        <button
          type="button"
          className={buttonClassName({ variant: "secondary", size: "small" })}
          disabled={pending}
          onClick={() => void run(() => resumeRequestRuntimeAction(lifecycleInput))}
        >
          <RotateCcw aria-hidden="true" size={15} />
          恢复
        </button>
      ) : null}
      {isDeveloper && !archived ? (
        <button
          type="button"
          className={buttonClassName({ variant: "quiet", size: "small" })}
          disabled={pending}
          onClick={() => setConfirming("archive")}
        >
          <Archive aria-hidden="true" size={15} />
          归档
        </button>
      ) : null}
      {isDeveloper && archived ? (
        <button
          type="button"
          className={buttonClassName({ variant: "secondary", size: "small" })}
          disabled={pending}
          onClick={() => void run(() => restoreRequestRuntimeAction(lifecycleInput))}
        >
          <RotateCcw aria-hidden="true" size={15} />
          恢复归档
        </button>
      ) : null}

      <ConfirmDialog
        open={confirming === "pause"}
        title="暂停这条需求？"
        description="暂停后需求将保持已排期状态并变为只读，开发者可以稍后恢复。"
        confirmLabel="确认暂停"
        pending={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void run(() => pauseRequestRuntimeAction(lifecycleInput))}
      />
      <ConfirmDialog
        open={confirming === "archive"}
        title="归档这条需求？"
        description="归档后需求会从默认列表隐藏，并保持只读。可在归档筛选中恢复。"
        confirmLabel="确认归档"
        destructive
        pending={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void run(() => archiveRequestRuntimeAction(lifecycleInput))}
      />
      {completionOpen ? (
        <CompleteRequestDialog
          open
          requestId={request.id}
          expectedVersion={request.version}
          onCancel={() => setCompletionOpen(false)}
          onCompleted={() => window.location.reload()}
        />
      ) : null}
    </div>
  );
}
