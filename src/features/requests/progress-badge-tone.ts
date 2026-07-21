import type { RequestProgressStatus } from "@/db/types";

export function progressBadgeTone(
  status: RequestProgressStatus,
): "neutral" | "blue" | "success" {
  if (status === "COMPLETED") return "success";
  if (status === "SCHEDULED") return "blue";
  return "neutral";
}
