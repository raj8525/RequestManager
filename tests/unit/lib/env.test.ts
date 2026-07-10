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

  it("forces secure cookies in production when configuration is absent", () => {
    expect(
      getEnvironment(environment({ NODE_ENV: "production" })).secureCookies,
    ).toBe(true);
  });

  it("does not allow production configuration to disable secure cookies", () => {
    expect(
      getEnvironment(
        environment({ NODE_ENV: "production", SECURE_COOKIES: "false" }),
      ).secureCookies,
    ).toBe(true);
  });
});
