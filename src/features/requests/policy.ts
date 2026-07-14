import type { AuthenticatedUser } from "@/auth/session-service";
import type {
  RequestProgressStatus,
  RequestRecordStatus,
} from "@/db/types";
import { DomainError } from "@/lib/domain-error";

export type RequestPolicySubject = {
  createdById: number;
  title: string | null;
  progressStatus: RequestProgressStatus;
  recordStatus: RequestRecordStatus;
};

export function canFillLegacyRequestTitle(
  actor: AuthenticatedUser,
  request: RequestPolicySubject,
): boolean {
  return (
    !actor.mustChangePassword &&
    actor.role === "CUSTOMER" &&
    actor.id === request.createdById &&
    request.title === null
  );
}

export type PolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "FORBIDDEN_ROLE" | "NOT_OWNER" | "INVALID_STATE";
    };

export function canEditRequest(
  actor: AuthenticatedUser,
  request: RequestPolicySubject,
): boolean {
  return (
    !actor.mustChangePassword &&
    actor.role === "CUSTOMER" &&
    actor.id === request.createdById &&
    request.progressStatus === "UNSCHEDULED" &&
    request.recordStatus === "ACTIVE"
  );
}

export function decidePause(
  actor: AuthenticatedUser,
  request: RequestPolicySubject,
): PolicyDecision {
  if (
    actor.mustChangePassword ||
    (actor.role !== "CUSTOMER" && actor.role !== "DEVELOPER")
  ) {
    return { allowed: false, reason: "FORBIDDEN_ROLE" };
  }
  if (
    request.progressStatus !== "SCHEDULED" ||
    request.recordStatus !== "ACTIVE"
  ) {
    return { allowed: false, reason: "INVALID_STATE" };
  }
  if (actor.role === "CUSTOMER" && actor.id !== request.createdById) {
    return { allowed: false, reason: "NOT_OWNER" };
  }
  return { allowed: true };
}

export function assertValidStateCombination(
  progressStatus: RequestProgressStatus,
  recordStatus: RequestRecordStatus,
): void {
  if (recordStatus === "PAUSED" && progressStatus !== "SCHEDULED") {
    throw new DomainError("CONFLICT", "暂停需求必须保持已排期状态");
  }
}
