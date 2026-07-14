/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeveloperQuestionForm } from "@/features/developer-questions/components/question-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DeveloperQuestionForm", () => {
  it("submits and remains retryable when randomUUID is unavailable on HTTP", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: "SYSTEM_UNAVAILABLE",
          message: "系统暂时不可用，请稍后重试",
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("crypto", {});
    vi.stubGlobal("fetch", fetchMock);
    render(
      <DeveloperQuestionForm
        projects={[{ id: 2, code: "WEB", name: "门户网站" }]}
      />,
    );

    fireEvent.change(screen.getByLabelText("项目"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("提问内容"), {
      target: { value: "请客户确认新版结算页的设计方向" },
    });
    const submitButton = screen.getByRole("button", { name: "创建提问" });
    const form = submitButton.closest("form");
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    await screen.findByRole("alert");
    expect(submitButton).toBeEnabled();
    fireEvent.submit(form!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const second = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect(first.get("idempotencyKey")).toBeTruthy();
    expect(second.get("idempotencyKey")).toBe(first.get("idempotencyKey"));
  });
});
