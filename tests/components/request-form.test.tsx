/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequestForm } from "@/features/requests/components/request-form";

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
    fireEvent.submit(screen.getByRole("form", { name: "新建需求" }));
    await screen.findByText("请刷新后重试");
    fireEvent.submit(screen.getByRole("form", { name: "新建需求" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const second = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect(first).toBeInstanceOf(FormData);
    expect(first.get("idempotencyKey")).toBeTruthy();
    expect(second.get("idempotencyKey")).toBe(first.get("idempotencyKey"));
  });
});
