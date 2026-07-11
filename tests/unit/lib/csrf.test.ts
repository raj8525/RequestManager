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

  it("accepts a same-host LAN origin when APP_ORIGIN uses another hostname", () => {
    const request = new Headers({
      host: "192.168.2.45:13001",
      origin: "http://192.168.2.45:13001",
    });

    expect(() =>
      assertSameOrigin(request, "http://requests.example.test"),
    ).not.toThrow();
  });

  it("accepts any LAN IP on the configured application port", () => {
    const request = new Headers({
      host: "localhost:13001",
      origin: "http://10.0.0.42:13001",
    });

    expect(() =>
      assertSameOrigin(request, "http://localhost:13001"),
    ).not.toThrow();
  });

  it("rejects a different origin host", () => {
    const request = new Headers({
      host: "192.168.2.45:13001",
      origin: "http://attacker.example",
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
