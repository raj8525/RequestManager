const REQUEST_NUMBER_PATTERN = /^REQ-(\d+)$/i;

export function formatRequestNumber(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RangeError("Request id must be a positive safe integer");
  }
  return `REQ-${String(id).padStart(6, "0")}`;
}

export function parseRequestNumber(value: string): number | null {
  const match = REQUEST_NUMBER_PATTERN.exec(value.trim());
  if (!match) return null;

  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
