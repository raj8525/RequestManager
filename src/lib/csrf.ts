import { isIP } from "node:net";

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
    const configured = new URL(configuredOrigin);
    applicationOrigin = configured.origin;

    // The app may be opened through localhost, a LAN address, or another
    // hostname. Accept the browser's same-host origin while retaining the
    // protocol check; APP_ORIGIN remains the canonical fallback.
    const requestHost = headers.get("host");
    if (requestHost && origin.protocol === configured.protocol && origin.host === requestHost) {
      return;
    }

    // LAN users may reach this single-host deployment through any assigned IP.
    // Keep the protocol and configured application port fixed so a random
    // website cannot use a different service endpoint as the request origin.
    if (
      isIP(origin.hostname) !== 0 &&
      origin.protocol === configured.protocol &&
      origin.port === configured.port
    ) {
      return;
    }
  } catch {
    throw new SameOriginError();
  }

  if (origin.origin !== applicationOrigin) throw new SameOriginError();
}
