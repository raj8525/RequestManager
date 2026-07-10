import { describe, expect, it } from "vitest";

import {
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "@/features/attachments/constants";
import {
  validateAttachmentLimits,
  validateImageFile,
} from "@/features/attachments/validation";
import {
  fakePngSvg,
  jpegFile,
  pngFile,
  webpFile,
} from "@/../tests/fixtures/images";

describe("attachment validation", () => {
  it.each([
    [pngFile(), "image/png"],
    [jpegFile(), "image/jpeg"],
    [webpFile(), "image/webp"],
  ])("accepts supported image signatures", async (file, mimeType) => {
    await expect(validateImageFile(file)).resolves.toMatchObject({ mimeType });
  });

  it("rejects SVG even when its declared MIME is image/png", async () => {
    await expect(validateImageFile(fakePngSvg())).rejects.toMatchObject({
      code: "ATTACHMENT_INVALID",
    });
  });

  it("rejects a declared MIME that disagrees with the file signature", async () => {
    await expect(
      validateImageFile(jpegFile("spoofed.png", undefined, "image/png")),
    ).rejects.toMatchObject({ code: "ATTACHMENT_INVALID" });
  });

  it("enforces the ten MiB per-file limit", async () => {
    await expect(
      validateImageFile(pngFile("too-large.png", MAX_ATTACHMENT_SIZE_BYTES + 1)),
    ).rejects.toMatchObject({ code: "ATTACHMENT_INVALID" });
  });

  it("enforces eight attachments and thirty MiB including retained files", () => {
    expect(() =>
      validateAttachmentLimits(
        Array.from({ length: MAX_ATTACHMENT_COUNT }, () => ({ sizeBytes: 1 })),
        [{ sizeBytes: 1 }],
      ),
    ).toThrow(expect.objectContaining({ code: "ATTACHMENT_INVALID" }));

    expect(() =>
      validateAttachmentLimits(
        [{ sizeBytes: MAX_ATTACHMENT_SIZE_BYTES }],
        [
          { sizeBytes: MAX_ATTACHMENT_SIZE_BYTES },
          { sizeBytes: MAX_ATTACHMENT_SIZE_BYTES },
          { sizeBytes: 1 },
        ],
      ),
    ).toThrow(expect.objectContaining({ code: "ATTACHMENT_INVALID" }));

    expect(() =>
      validateAttachmentLimits(
        [{ sizeBytes: MAX_ATTACHMENT_SIZE_BYTES }],
        [
          { sizeBytes: MAX_ATTACHMENT_SIZE_BYTES },
          { sizeBytes: MAX_ATTACHMENT_SIZE_BYTES },
        ],
      ),
    ).not.toThrow();
  });
});
