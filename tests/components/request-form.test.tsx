/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequestForm } from "@/features/requests/components/request-form";
import type { RequestDto } from "@/features/requests/presenter";

afterEach(cleanup);

describe("RequestForm", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("associates server field errors with the corresponding control and preserves input", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            code: "INVALID_INPUT",
            message: "提交的信息无效",
            fieldErrors: { content: ["需求正文至少需要 10 个字符"] },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    render(
      <RequestForm
        mode="create"
        projects={[{ id: 2, code: "WEB", name: "门户网站" }]}
      />,
    );

    fireEvent.change(screen.getByLabelText("标题"), {
      target: { value: "保存按钮没有响应" },
    });

    const content = screen.getByLabelText("需求内容");
    fireEvent.change(content, { target: { value: "保留我输入的内容" } });
    fireEvent.submit(screen.getByRole("form", { name: "新建需求" }));

    const error = await screen.findByText("需求正文至少需要 10 个字符");
    expect(content).toHaveValue("保留我输入的内容");
    expect(content).toHaveAttribute("aria-invalid", "true");
    expect(content.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("submits multipart data with one stable idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, code: "CONFLICT", message: "请刷新后重试" }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <RequestForm
        mode="create"
        projects={[{ id: 2, code: "WEB", name: "门户网站" }]}
      />,
    );

    fireEvent.change(screen.getByLabelText("需求内容"), {
      target: { value: "保存按钮点击后没有响应，需要修复。" },
    });
    fireEvent.change(screen.getByLabelText("标题"), {
      target: { value: "保存按钮没有响应" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "新建需求" }));
    await screen.findByText("请刷新后重试");
    fireEvent.submit(screen.getByRole("form", { name: "新建需求" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const second = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect(first).toBeInstanceOf(FormData);
    expect(first.get("title")).toBe("保存按钮没有响应");
    expect(first.get("idempotencyKey")).toBeTruthy();
    expect(second.get("idempotencyKey")).toBe(first.get("idempotencyKey"));
  });

  it("renders a title-only form for a legacy request", () => {
    render(
      <RequestForm
        mode="fill-title"
        projects={[{ id: 2, code: "WEB", name: "门户网站" }]}
        initialRequest={{
          id: 7,
          requestNumber: "REQ-000007",
          projectId: 2,
          createdById: 3,
          title: null,
          content: "历史需求正文不能在补标题时修改。",
          summary: "历史需求正文不能在补标题时修改。",
          requestType: "BUG",
          priority: "NORMAL",
          progressStatus: "COMPLETED",
          recordStatus: "ARCHIVED",
          needsCustomerReply: false,
          version: 2,
          createdAt: new Date("2026-07-09T09:00:00.000Z"),
          updatedAt: new Date("2026-07-10T09:00:00.000Z"),
        }}
      />,
    );
    expect(screen.getByLabelText("标题")).toBeVisible();
    expect(screen.queryByLabelText("需求内容")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存标题" })).toBeVisible();
  });

  it("disables removal of retained screenshots while an edit is submitting", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const initialRequest: RequestDto = {
      id: 7,
      requestNumber: "REQ-000007",
      projectId: 2,
      createdById: 3,
      title: "保存按钮点击后没有响应",
      content: "保存按钮点击后没有响应，需要修复。",
      summary: "保存按钮点击后没有响应，需要修复。",
      requestType: "BUG",
      priority: "NORMAL",
      progressStatus: "UNSCHEDULED",
      recordStatus: "ACTIVE",
      needsCustomerReply: false,
      version: 2,
      createdAt: new Date("2026-07-09T09:00:00.000Z"),
      updatedAt: new Date("2026-07-10T09:00:00.000Z"),
    };
    render(
      <RequestForm
        mode="edit"
        projects={[{ id: 2, code: "WEB", name: "门户网站" }]}
        initialRequest={initialRequest}
        initialAttachments={[
          {
            id: 11,
            originalName: "existing.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            createdAt: new Date("2026-07-10T08:00:00.000Z"),
            url: "/api/attachments/11",
          },
        ]}
      />,
    );

    const removeButton = screen.getByRole("button", {
      name: "移除 existing.png",
    });
    expect(removeButton).toBeEnabled();
    fireEvent.submit(screen.getByRole("form", { name: "编辑需求" }));

    await waitFor(() => expect(removeButton).toBeDisabled());
  });
});
