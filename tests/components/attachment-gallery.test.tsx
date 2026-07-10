/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AttachmentGallery } from "@/features/attachments/attachment-gallery";

afterEach(cleanup);

describe("AttachmentGallery", () => {
  it("uses a stable preview ratio and contains the full screenshot", () => {
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
        ]}
      />,
    );

    const image = screen.getByAltText("long-page.png");
    expect(image.closest("a")).toHaveStyle({ aspectRatio: "16 / 9" });
    expect(image).toHaveStyle({ objectFit: "contain" });
  });
});
