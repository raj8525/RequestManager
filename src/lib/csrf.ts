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

    // The browser may reach the app through localhost, a LAN address, or a
    // TLS-terminating tunnel. The tunnel's public host is the browser-visible
    // same-origin boundary even when the internal service uses HTTP.
    const requestHost =
      headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim() ||
      headers.get("host");
    const forwardedProtocol = headers
      .get("x-forwarded-proto")
      ?.split(",", 1)[0]
      ?.trim()
      .toLowerCase();
    const expectedProtocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : configured.protocol;
    if (
      requestHost &&
      origin.host === requestHost &&
      origin.protocol === expectedProtocol
    ) {
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
