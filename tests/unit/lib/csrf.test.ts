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

  it("accepts an origin matching the request host", () => {
    const request = new Request("http://localhost/actions", {
      headers: { host: "localhost:3000", origin: "http://localhost:3000" },
    });

    expect(() =>
      assertSameOrigin(request, "https://requests.example.test"),
    ).not.toThrow();
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
