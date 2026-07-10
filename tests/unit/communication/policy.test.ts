import { describe, expect, it } from "vitest";

import {
  canWriteCommunication,
  deriveNeedsCustomerReply,
} from "@/features/communication/policy";

describe("communication policy", () => {
  it("allows communication writes only on active requests", () => {
    expect(canWriteCommunication("ACTIVE")).toBe(true);
    expect(canWriteCommunication("PAUSED")).toBe(false);
    expect(canWriteCommunication("ARCHIVED")).toBe(false);
  });

  it("shows pending only for an active request whose last message is from a developer", () => {
    expect(deriveNeedsCustomerReply("ACTIVE", "DEVELOPER")).toBe(true);
    expect(deriveNeedsCustomerReply("ACTIVE", "CUSTOMER")).toBe(false);
    expect(deriveNeedsCustomerReply("ACTIVE", null)).toBe(false);
    expect(deriveNeedsCustomerReply("PAUSED", "DEVELOPER")).toBe(false);
    expect(deriveNeedsCustomerReply("ARCHIVED", "DEVELOPER")).toBe(false);
  });
});
