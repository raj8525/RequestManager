/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RequestList } from "@/features/requests/components/request-list";
import type { RequestViewDto } from "@/features/requests/presenter";

afterEach(cleanup);

function requestDto(
  overrides: Partial<RequestViewDto> = {},
): RequestViewDto {
  return {
    id: 7,
    requestNumber: "REQ-000007",
    projectId: 2,
    createdById: 3,
    content: "保存按钮点击后没有响应，需要修复。",
    summary: "保存按钮点击后没有响应，需要修复。",
    requestType: "BUG",
    priority: "URGENT",
    progressStatus: "UNSCHEDULED",
    recordStatus: "ACTIVE",
    needsCustomerReply: true,
    version: 2,
    createdAt: new Date("2026-07-09T09:00:00.000Z"),
    updatedAt: new Date("2026-07-10T09:00:00.000Z"),
    project: {
      id: 2,
      code: "WEB",
      name: "门户网站",
      isActive: true,
    },
    createdBy: { id: 3, displayName: "王客户" },
    ...overrides,
  };
}

describe("RequestList", () => {
  it("renders text as well as color for pending customer replies", () => {
    render(<RequestList role="CUSTOMER" items={[requestDto()]} />);

    const row = screen.getByTestId("request-row-REQ-000007");
    expect(within(row).getByText("待您回复")).toBeVisible();
    expect(row).toHaveAttribute("data-attention", "customer-reply");
  });

  it("keeps one stable row with the essential desktop and mobile information", () => {
    render(<RequestList role="CUSTOMER" items={[requestDto()]} />);

    expect(screen.getAllByTestId(/^request-row-/)).toHaveLength(1);
    const row = screen.getByTestId("request-row-REQ-000007");
    expect(within(row).getByRole("link", { name: "REQ-000007" })).toHaveAttribute(
      "href",
      "/requests/REQ-000007",
    );
    expect(within(row).getByText("门户网站")).toBeVisible();
    expect(within(row).getByText("王客户")).toBeVisible();
    expect(within(row).getByText("加急")).toBeVisible();
    expect(within(row).getByText("未排期")).toBeVisible();
  });

  it("renders customer content as plain text instead of HTML", () => {
    const { container } = render(
      <RequestList
        role="CUSTOMER"
        items={[
          requestDto({
            content: "<b>不要执行</b>，这里是用户输入。",
            summary: "<b>不要执行</b>，这里是用户输入。",
            needsCustomerReply: false,
          }),
        ]}
      />,
    );

    expect(screen.getByText("<b>不要执行</b>，这里是用户输入。")).toBeVisible();
    expect(container.querySelector("b")).toBeNull();
  });

  it("uses developer wording without presenting a customer-only action", () => {
    render(<RequestList role="DEVELOPER" items={[requestDto()]} />);

    expect(screen.getByText("待客户回复")).toBeVisible();
    expect(screen.queryByText("待您回复")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "新建需求" })).not.toBeInTheDocument();
  });

  it("offers compact lifecycle controls to a developer from the list", () => {
    render(
      <RequestList role="DEVELOPER" actorId={8} items={[requestDto()]} />,
    );

    expect(screen.getByLabelText("更新进度")).toHaveValue("UNSCHEDULED");
    expect(screen.getByRole("button", { name: "归档" })).toBeVisible();
  });

  it("renders sorting links and keeps customer actions in the final cell", () => {
    render(
      <RequestList
        role="CUSTOMER"
        actorId={3}
        items={[requestDto({ needsCustomerReply: false })]}
        sort="updatedAt"
        direction="desc"
        searchParams={{ projectId: "2", page: "3" }}
      />,
    );

    const updatedHeader = screen.getByRole("columnheader", { name: /更新时间/ });
    expect(updatedHeader).toHaveAttribute("aria-sort", "descending");
    expect(within(updatedHeader).getByRole("link")).toHaveAttribute(
      "href",
      "/requests?projectId=2&sort=updatedAt&direction=asc",
    );

    const row = screen.getByTestId("request-row-REQ-000007");
    const cells = within(row).getAllByRole("cell");
    expect(within(cells[0]!).queryByRole("link", { name: "编辑" })).toBeNull();
    expect(within(cells.at(-1)!).getByRole("link", { name: "编辑" })).toBeVisible();
  });

  it("shows a useful empty state", () => {
    render(<RequestList role="CUSTOMER" items={[]} />);
    expect(screen.getByText("没有找到符合条件的需求")).toBeVisible();
  });
});
