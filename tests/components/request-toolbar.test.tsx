/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequestToolbar } from "@/features/requests/components/request-toolbar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RequestToolbar", () => {
  it("submits the filter form whenever a select value changes", () => {
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => undefined);

    render(
      <RequestToolbar
        projects={[{ id: 7, code: "APP", name: "客户应用" }]}
        values={{ search: "保存", sort: "updatedAt", direction: "desc" }}
      />,
    );

    for (const [label, value] of [
      ["按项目筛选", "7"],
      ["按类型筛选", "BUG"],
      ["按优先级筛选", "IMPORTANT"],
      ["按进度筛选", "COMPLETED"],
      ["按记录状态筛选", "ARCHIVED"],
    ] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }

    expect(requestSubmit).toHaveBeenCalledTimes(5);
    expect(screen.getByRole("button", { name: "筛选" })).toBeVisible();
  });
});
