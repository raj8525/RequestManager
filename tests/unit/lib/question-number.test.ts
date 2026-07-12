import { describe, expect, it } from "vitest";

import {
  formatQuestionNumber,
  parseQuestionNumber,
} from "@/lib/question-number";

describe("developer question numbers", () => {
  it("formats and parses ASK identifiers", () => {
    expect(formatQuestionNumber(12)).toBe("ASK-000012");
    expect(parseQuestionNumber("ask-000012")).toBe(12);
    expect(parseQuestionNumber("REQ-000012")).toBeNull();
  });

  it("rejects invalid numeric identifiers", () => {
    expect(() => formatQuestionNumber(0)).toThrow(RangeError);
    expect(parseQuestionNumber("ASK-0")).toBeNull();
  });
});
