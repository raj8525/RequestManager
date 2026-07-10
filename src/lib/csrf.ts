import { getEnvironment } from "@/lib/env";

export class SameOriginError extends Error {
  readonly code = "INVALID_ORIGIN";

  constructor() {
    super("Request origin is not allowed");
    this.name = "SameOriginError";
  }
}

function requestHeaders(input: Headers | Request): Headers {
  return input instanceof Headers ? input : input.headers;
}

export function assertSameOrigin(
  input: Headers | Request,
  configuredOrigin = getEnvironment().appOrigin,
): void {
  const headers = requestHeaders(input);
  const rawOrigin = headers.get("origin");
  if (!rawOrigin || rawOrigin === "null") throw new SameOriginError();

  let origin: URL;
  let applicationOrigin: string;
  try {
    origin = new URL(rawOrigin);
    applicationOrigin = new URL(configuredOrigin).origin;
  } catch {
    throw new SameOriginError();
  }

  if (origin.origin !== applicationOrigin) throw new SameOriginError();
}
