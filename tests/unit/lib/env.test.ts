import { describe, expect, it } from "vitest";

import { getEnvironment } from "@/lib/env";

function environment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides } as NodeJS.ProcessEnv;
}

describe("getEnvironment", () => {
  it("does not trust proxy headers by default", () => {
    expect(getEnvironment(environment()).trustProxyHeaders).toBe(false);
  });

  it("enables proxy headers only through explicit configuration", () => {
    expect(
      getEnvironment(environment({ TRUST_PROXY_HEADERS: "true" }))
        .trustProxyHeaders,
    ).toBe(true);
  });

  it("uses non-secure cookies for an HTTP production origin", () => {
    expect(
      getEnvironment(environment({ NODE_ENV: "production" })).secureCookies,
    ).toBe(false);
  });

  it("uses secure cookies for an HTTPS origin", () => {
    expect(
      getEnvironment(
        environment({ NODE_ENV: "production", APP_ORIGIN: "https://requests.example.test" }),
      ).secureCookies,
    ).toBe(true);
  });

  it("allows explicitly secure cookies for an HTTP origin", () => {
    expect(
      getEnvironment(environment({ SECURE_COOKIES: "true" })).secureCookies,
    ).toBe(true);
  });
});
