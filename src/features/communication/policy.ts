import type { RequestRecordStatus, UserRole } from "@/db/types";

export function canWriteCommunication(
  recordStatus: RequestRecordStatus,
): boolean {
  return recordStatus === "ACTIVE";
}

export function deriveNeedsCustomerReply(
  recordStatus: RequestRecordStatus,
  lastAuthorRole: UserRole | null,
): boolean {
  return recordStatus === "ACTIVE" && lastAuthorRole === "DEVELOPER";
}
