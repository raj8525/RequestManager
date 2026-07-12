const QUESTION_NUMBER_PATTERN = /^ASK-(\d+)$/i;

export function formatQuestionNumber(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RangeError("Question id must be a positive safe integer");
  }
  return `ASK-${String(id).padStart(6, "0")}`;
}

export function parseQuestionNumber(value: string): number | null {
  const match = QUESTION_NUMBER_PATTERN.exec(value.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
