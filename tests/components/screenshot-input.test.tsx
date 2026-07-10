/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScreenshotInput } from "@/features/attachments/screenshot-input";

afterEach(cleanup);

function clipboardItem(file: File): DataTransferItem {
  return {
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  } as DataTransferItem;
}

function pasteData(...files: File[]): Pick<DataTransfer, "files" | "items"> {
  return {
    files: files as unknown as FileList,
    items: files.map(clipboardItem) as unknown as DataTransferItemList,
  };
}

describe("ScreenshotInput", () => {
  it("adds an image clipboard item without treating plain text as an attachment", () => {
    const onChange = vi.fn();
    render(
      <>
        <textarea aria-label="需求内容" data-screenshot-paste-target="true" />
        <ScreenshotInput value={[]} onChange={onChange} />
      </>,
    );

    fireEvent.paste(screen.getByLabelText("需求内容"), {
      clipboardData: {
        items: [
          { kind: "string", type: "text/plain", getAsFile: () => null },
        ],
      },
    });
    expect(onChange).not.toHaveBeenCalled();

    const image = new File([new Uint8Array([1, 2, 3])], "粘贴截图.png", {
      type: "image/png",
    });
    fireEvent.paste(screen.getByLabelText("需求内容"), {
      clipboardData: pasteData(image),
    });

    expect(onChange).toHaveBeenCalledWith([image]);
  });

  it("explains the eight-image limit and keeps the previous selection", () => {
    const existing = Array.from(
      { length: 8 },
      (_, index) =>
        new File([String(index)], `screen-${index}.png`, { type: "image/png" }),
    );
    const onChange = vi.fn();
    render(<ScreenshotInput value={existing} onChange={onChange} />);

    fireEvent.drop(screen.getByTestId("screenshot-input"), {
      dataTransfer: pasteData(
        new File(["next"], "screen-next.png", { type: "image/png" }),
      ),
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "每条需求最多上传 8 张截图",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects unsupported images before submission", () => {
    const onChange = vi.fn();
    render(<ScreenshotInput value={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("选择截图"), {
      target: {
        files: [new File(["gif"], "moving.gif", { type: "image/gif" })],
      },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "仅支持 PNG、JPEG 或 WebP 图片",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows selected files and removes one with an accessible control", () => {
    const file = new File(["image"], "problem.png", { type: "image/png" });
    const onChange = vi.fn();
    render(<ScreenshotInput value={[file]} onChange={onChange} />);

    const preview = screen.getByRole("listitem");
    expect(within(preview).getByText("problem.png")).toBeVisible();
    fireEvent.click(within(preview).getByRole("button", { name: "移除 problem.png" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
