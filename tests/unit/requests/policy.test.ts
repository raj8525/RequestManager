import { describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/auth/session-service";
import {
  assertValidStateCombination,
  canFillLegacyRequestTitle,
  canEditRequest,
  decidePause,
  type RequestPolicySubject,
} from "@/features/requests/policy";
import { formatRequestNumber, parseRequestNumber } from "@/lib/request-number";

function actor(
  id: number,
  role: "CUSTOMER" | "DEVELOPER" = "CUSTOMER",
): AuthenticatedUser {
  return {
    id,
    username: `user-${id}`,
    displayName: `User ${id}`,
    role,
    mustChangePassword: false,
  };
}

function request(
  overrides: Partial<RequestPolicySubject> = {},
): RequestPolicySubject {
  return {
    createdById: 1,
    title: "已存在标题",
    progressStatus: "UNSCHEDULED",
    recordStatus: "ACTIVE",
    ...overrides,
  };
}

describe("request policy", () => {
  it("allows only the creator to edit an active unscheduled request", () => {
    expect(canEditRequest(actor(1), request())).toBe(true);
    expect(canEditRequest(actor(2), request())).toBe(false);
    expect(canEditRequest(actor(1, "DEVELOPER"), request())).toBe(false);
    expect(
      canEditRequest(actor(1), request({ progressStatus: "SCHEDULED" })),
    ).toBe(false);
    expect(
      canEditRequest(actor(1), request({ recordStatus: "ARCHIVED" })),
    ).toBe(false);
  });

  it.each([
    ["SCHEDULED", "ACTIVE"],
    ["COMPLETED", "ACTIVE"],
    ["SCHEDULED", "PAUSED"],
    ["COMPLETED", "ARCHIVED"],
  ] as const)("allows only the owner to fill a missing legacy title in %s + %s", (progressStatus, recordStatus) => {
    const legacy = request({
      title: null,
      progressStatus,
      recordStatus,
    });
    expect(canFillLegacyRequestTitle(actor(1), legacy)).toBe(true);
    expect(canFillLegacyRequestTitle(actor(2), legacy)).toBe(false);
    expect(canFillLegacyRequestTitle(actor(1, "DEVELOPER"), legacy)).toBe(false);
    expect(canFillLegacyRequestTitle(actor(1), request())).toBe(false);
  });

  it("permits customer pause only for their own active scheduled request", () => {
    const scheduled = request({ progressStatus: "SCHEDULED" });

    expect(decidePause(actor(1), scheduled)).toEqual({ allowed: true });
    expect(decidePause(actor(2), scheduled).allowed).toBe(false);
    expect(decidePause(actor(9, "DEVELOPER"), scheduled)).toEqual({
      allowed: true,
    });
    expect(decidePause(actor(1), request()).allowed).toBe(false);
    expect(
      decidePause(
        actor(9, "DEVELOPER"),
        request({ progressStatus: "SCHEDULED", recordStatus: "PAUSED" }),
      ).allowed,
    ).toBe(false);
  });

  it("rejects paused state combinations other than scheduled plus paused", () => {
    expect(() => assertValidStateCombination("SCHEDULED", "PAUSED")).not.toThrow();
    expect(() => assertValidStateCombination("UNSCHEDULED", "ACTIVE")).not.toThrow();
    expect(() => assertValidStateCombination("COMPLETED", "ARCHIVED")).not.toThrow();
    expect(() => assertValidStateCombination("UNSCHEDULED", "PAUSED")).toThrow();
    expect(() => assertValidStateCombination("COMPLETED", "PAUSED")).toThrow();
  });

  it("formats and strictly parses stable request numbers", () => {
    expect(formatRequestNumber(1)).toBe("REQ-000001");
    expect(formatRequestNumber(1_234_567)).toBe("REQ-1234567");
    expect(parseRequestNumber("REQ-000001")).toBe(1);
    expect(parseRequestNumber(" req-000042 ")).toBe(42);
    expect(parseRequestNumber("REQ-000000")).toBeNull();
    expect(parseRequestNumber("42")).toBeNull();
    expect(parseRequestNumber("REQ-1x")).toBeNull();
  });
});
