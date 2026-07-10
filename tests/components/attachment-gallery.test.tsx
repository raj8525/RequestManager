/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AttachmentGallery } from "@/features/attachments/attachment-gallery";

afterEach(cleanup);

describe("AttachmentGallery", () => {
  it("opens screenshots in a same-page dialog and supports keyboard navigation", () => {
    render(
      <AttachmentGallery
        attachments={[
          {
            id: 3,
            originalName: "long-page.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            createdAt: new Date("2026-07-10T08:00:00.000Z"),
            url: "/api/attachments/3",
          },
          {
            id: 4,
            originalName: "second-image.png",
            mimeType: "image/png",
            sizeBytes: 2048,
            createdAt: new Date("2026-07-10T08:01:00.000Z"),
            url: "/api/attachments/4",
          },
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "放大查看 long-page.png" }),
    );

    const dialog = screen.getByRole("dialog", { name: "截图预览" });
    expect(within(dialog).getByAltText("long-page.png")).toBeVisible();
    expect(within(dialog).getByText("1 / 2")).toBeVisible();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(dialog).getByAltText("second-image.png")).toBeVisible();
    expect(within(dialog).getByText("2 / 2")).toBeVisible();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(within(dialog).getByAltText("long-page.png")).toBeVisible();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(dialog).not.toBeInTheDocument();
  });
});
