/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RequestDetail } from "@/features/requests/components/request-detail";
import type { RequestViewDto } from "@/features/requests/presenter";

afterEach(cleanup);

const request: RequestViewDto = {
  id: 7,
  requestNumber: "REQ-000007",
  projectId: 2,
  createdById: 3,
  content: "<b>原样显示</b>，不要作为 HTML 执行。",
  summary: "<b>原样显示</b>，不要作为 HTML 执行。",
  requestType: "BUG",
  priority: "IMPORTANT",
  progressStatus: "SCHEDULED",
  recordStatus: "ACTIVE",
  needsCustomerReply: true,
  version: 4,
  createdAt: new Date("2026-07-09T09:00:00.000Z"),
  updatedAt: new Date("2026-07-10T09:00:00.000Z"),
  project: { id: 2, code: "WEB", name: "门户网站", isActive: true },
  createdBy: { id: 3, displayName: "王客户" },
};

describe("RequestDetail", () => {
  it("assembles only customer-visible communication sections", () => {
    const { container } = render(
      <RequestDetail
        actor={{ id: 3, role: "CUSTOMER" }}
        request={request}
        attachments={[]}
        remarks={[
          {
            id: 1,
            requestId: 7,
            author: { id: 8, displayName: "李开发" },
            content: "公开给客户的备注",
            createdAt: new Date("2026-07-10T08:00:00.000Z"),
          },
        ]}
        clarifications={[]}
        events={[
          {
            id: 12,
            eventType: "PROGRESS_CHANGED",
            actor: { id: 8, displayName: "李开发" },
            change: { from: "UNSCHEDULED", to: "SCHEDULED" },
            createdAt: new Date("2026-07-10T08:30:00.000Z"),
          },
        ]}
      />,
    );

    expect(screen.getByText("公开给客户的备注")).toBeVisible();
    expect(screen.getByRole("heading", { name: "确认与澄清" })).toBeVisible();
    expect(screen.queryByText("私人笔记")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交回复" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "操作历史" })).toBeVisible();
    expect(screen.getByText("未排期改为已排期")).toBeVisible();
    expect(screen.getByText("<b>原样显示</b>，不要作为 HTML 执行。")).toBeVisible();
    expect(container.querySelector("b")).toBeNull();
  });

  it("shows the current developer private note editor without exposing it through shared sections", () => {
    render(
      <RequestDetail
        actor={{ id: 8, role: "DEVELOPER" }}
        request={{ ...request, needsCustomerReply: false }}
        attachments={[]}
        remarks={[]}
        clarifications={[]}
        events={[]}
        privateNote={{
          id: 9,
          requestId: 7,
          content: "仅当前开发者可见",
          createdAt: new Date("2026-07-10T08:00:00.000Z"),
          updatedAt: new Date("2026-07-10T08:00:00.000Z"),
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "客户可见备注" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "确认与澄清" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "私人笔记" })).toBeVisible();
    expect(screen.getByDisplayValue("仅当前开发者可见")).toBeVisible();
    expect(screen.getByRole("button", { name: "提出问题" })).toBeVisible();
  });
});
