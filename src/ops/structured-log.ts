type LogFields = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN =
  /(password|passphrase|secret|token|cookie|authorization|body|content|private.?note|screenshot.?bytes|attachment.?bytes)/i;

function sanitizeValue(
  value: unknown,
  seen: WeakSet<object>,
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return "[REDACTED]";
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : sanitizeValue(item, seen),
    ]),
  );
}

export function serializeStructuredLog(
  event: string,
  fields: LogFields = {},
  now: Date = new Date(),
): string {
  if (!/^[a-z][a-z0-9_]*$/.test(event)) {
    throw new Error("structured log event name is invalid");
  }
  const sanitized = sanitizeValue(fields, new WeakSet<object>()) as LogFields;
  return JSON.stringify({
    ...sanitized,
    timestamp: now.toISOString(),
    event,
  });
}

export function writeStructuredLog(
  event: string,
  fields: LogFields = {},
  writer: (line: string) => void = console.log,
): void {
  writer(serializeStructuredLog(event, fields));
}
