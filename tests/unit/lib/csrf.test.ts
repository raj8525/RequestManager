import { describe, expect, it } from "vitest";

import { SameOriginError, assertSameOrigin } from "@/lib/csrf";

describe("assertSameOrigin", () => {
  it("accepts the configured application origin", () => {
    const headers = new Headers({
      host: "internal.example.test",
      origin: "https://requests.example.test",
    });

    expect(() =>
      assertSameOrigin(headers, "https://requests.example.test"),
    ).not.toThrow();
  });

  it("rejects an origin that matches the request host but not APP_ORIGIN", () => {
    const request = new Request("http://localhost/actions", {
      headers: { host: "localhost:3000", origin: "http://localhost:3000" },
    });

    expect(() =>
      assertSameOrigin(request, "https://requests.example.test"),
    ).toThrow(SameOriginError);
  });

  it("rejects the configured host and port over a different protocol", () => {
    const headers = new Headers({
      host: "requests.example.test",
      origin: "http://requests.example.test",
      "x-forwarded-proto": "http",
    });

    expect(() =>
      assertSameOrigin(headers, "https://requests.example.test"),
    ).toThrow(SameOriginError);
  });

  it("rejects missing, opaque and cross-origin requests", () => {
    expect(() =>
      assertSameOrigin(new Headers({ host: "localhost:3000" }), "http://localhost:3000"),
    ).toThrow(SameOriginError);
    expect(() =>
      assertSameOrigin(
        new Headers({ host: "localhost:3000", origin: "null" }),
        "http://localhost:3000",
      ),
    ).toThrow(SameOriginError);
    expect(() =>
      assertSameOrigin(
        new Headers({
          host: "localhost:3000",
          origin: "https://attacker.example",
        }),
        "http://localhost:3000",
      ),
    ).toThrow(SameOriginError);
  });
});
