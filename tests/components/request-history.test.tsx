/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RequestHistory } from "@/features/requests/components/request-history";

afterEach(cleanup);

describe("RequestHistory", () => {
  it("renders Chinese event labels, actor, time and a safe state transition", () => {
    render(
      <RequestHistory
        events={[
          {
            id: 7,
            eventType: "PROGRESS_CHANGED",
            actor: { id: 3, displayName: "李开发" },
            change: { from: "UNSCHEDULED", to: "SCHEDULED" },
            createdAt: new Date("2026-07-10T08:00:00.000Z"),
          },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "操作历史" })).toBeVisible();
    expect(screen.getByText("更新了进度")).toBeVisible();
    expect(screen.getByText("未排期改为已排期")).toBeVisible();
    expect(screen.getByText("李开发")).toBeVisible();
    expect(screen.getByRole("time")).toHaveAttribute(
      "datetime",
      "2026-07-10T08:00:00.000Z",
    );
  });

  it("shows a calm empty state", () => {
    render(<RequestHistory events={[]} />);
    expect(screen.getByText("暂无操作历史")).toBeVisible();
  });
});
