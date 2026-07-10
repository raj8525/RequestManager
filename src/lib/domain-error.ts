import type { ActionFailureCode } from "@/lib/action-result";

export class DomainError extends Error {
  constructor(
    readonly code: ActionFailureCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
