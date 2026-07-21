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
  title: "保存按钮点击后没有响应",
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
  it("hides empty customer communication sections", () => {
    render(
      <RequestDetail
        actor={{ id: 3, role: "CUSTOMER" }}
        request={{ ...request, needsCustomerReply: false }}
        attachments={[]}
        remarks={[]}
        clarifications={[]}
        events={[]}
      />,
    );

    expect(screen.queryByRole("heading", { name: "备注" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "确认与澄清" }),
    ).not.toBeInTheDocument();
  });

  it("marks populated clarification and completion sections with semantic colors", () => {
    render(
      <RequestDetail
        actor={{ id: 3, role: "CUSTOMER" }}
        request={{ ...request, needsCustomerReply: false }}
        attachments={[]}
        remarks={[]}
        clarifications={[
          {
            id: 31,
            requestId: 7,
            author: { id: 8, displayName: "李开发" },
            authorRole: "DEVELOPER",
            content: "请确认复现步骤",
            createdAt: new Date("2026-07-10T08:20:00.000Z"),
          },
        ]}
        completionNote={{
          id: 4,
          requestId: 7,
          content: "已完成",
          updatedBy: { id: 8, displayName: "李开发" },
          createdAt: new Date("2026-07-10T08:40:00.000Z"),
          updatedAt: new Date("2026-07-10T08:40:00.000Z"),
          attachments: [],
        }}
        events={[]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "确认与澄清" }).closest("section"),
    ).toHaveClass("detail-section--clarification-has-content");
    expect(
      screen.getByRole("heading", { name: "完成说明" }).closest("section"),
    ).toHaveClass("detail-section--completion");
  });

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
            attachments: [{
              id: 21,
              originalName: "remark.png",
              mimeType: "image/png",
              sizeBytes: 100,
              createdAt: new Date("2026-07-10T08:00:00.000Z"),
              url: "/api/public-remark-attachments/21",
            }],
          },
        ]}
        clarifications={[]}
        events={[
          {
            id: 12,
            eventType: "PROGRESS_CHANGED",
            actor: { id: 8, displayName: "李开发" },
            change: { from: "UNSCHEDULED", to: "SCHEDULED" },
            subject: null,
            createdAt: new Date("2026-07-10T08:30:00.000Z"),
          },
        ]}
        completionNote={{
          id: 4,
          requestId: 7,
          content: "已修复保存按钮并完成回归验证",
          updatedBy: { id: 8, displayName: "李开发" },
          createdAt: new Date("2026-07-10T08:40:00.000Z"),
          updatedAt: new Date("2026-07-10T08:40:00.000Z"),
          attachments: [{
            id: 22,
            originalName: "completed.png",
            mimeType: "image/png",
            sizeBytes: 120,
            createdAt: new Date("2026-07-10T08:40:00.000Z"),
            url: "/api/completion-note-attachments/22",
          }],
        }}
      />,
    );

    expect(screen.getByText("公开给客户的备注")).toBeVisible();
    expect(screen.getByRole("img", { name: "remark.png" })).toHaveAttribute(
      "src",
      "/api/public-remark-attachments/21",
    );
    expect(screen.getByText("已修复保存按钮并完成回归验证")).toBeVisible();
    expect(screen.getByRole("img", { name: "completed.png" })).toHaveAttribute(
      "src",
      "/api/completion-note-attachments/22",
    );
    expect(screen.getByRole("heading", { name: "确认与澄清" })).toBeVisible();
    expect(screen.queryByText("私人笔记")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交回复" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "操作历史" })).toBeVisible();
    expect(screen.getByText("未排期改为已排期")).toBeVisible();
    expect(screen.getByText("<b>原样显示</b>，不要作为 HTML 执行。")).toBeVisible();
    expect(screen.getByRole("heading", { name: "保存按钮点击后没有响应" })).toBeVisible();
    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "编辑" })).toHaveAttribute(
      "title",
      "仅正常且未排期的需求可以编辑",
    );
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

    expect(screen.getByRole("heading", { name: "备注" })).toBeVisible();
    expect(screen.queryByText("客户可见备注")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "确认与澄清" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "私人笔记" })).toBeVisible();
    expect(screen.getByDisplayValue("仅当前开发者可见")).toBeVisible();
    expect(screen.getByRole("button", { name: "提出问题" })).toBeVisible();
    expect(screen.getByRole("button", { name: "保存完成说明" })).toBeVisible();
    expect(screen.getAllByText("粘贴、拖放或选择截图").length).toBeGreaterThanOrEqual(3);
  });
});
