import { createHash } from "node:crypto";

import { fileTypeFromBuffer } from "file-type";

import { DomainError } from "@/lib/domain-error";

import {
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  SUPPORTED_ATTACHMENT_MIME_TYPES,
  type SupportedAttachmentMimeType,
} from "./constants";

export type AttachmentSize = { sizeBytes: number };

export type ValidatedImageFile = {
  originalName: string;
  mimeType: SupportedAttachmentMimeType;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
};

function invalidAttachment(message: string): DomainError {
  return new DomainError("ATTACHMENT_INVALID", message, {
    attachments: [message],
  });
}

function isSupportedMimeType(
  value: string,
): value is SupportedAttachmentMimeType {
  return SUPPORTED_ATTACHMENT_MIME_TYPES.includes(
    value as SupportedAttachmentMimeType,
  );
}

export function validateAttachmentLimits(
  newAttachments: readonly AttachmentSize[],
  retainedAttachments: readonly AttachmentSize[] = [],
): void {
  const combined = [...retainedAttachments, ...newAttachments];
  if (combined.length > MAX_ATTACHMENT_COUNT) {
    throw invalidAttachment(`每条需求最多上传 ${MAX_ATTACHMENT_COUNT} 张截图`);
  }

  let totalBytes = 0;
  for (const attachment of combined) {
    if (
      !Number.isSafeInteger(attachment.sizeBytes) ||
      attachment.sizeBytes < 0 ||
      attachment.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES
    ) {
      throw invalidAttachment("每张截图不能超过 10 MiB");
    }
    totalBytes += attachment.sizeBytes;
  }
  if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
    throw invalidAttachment("全部截图合计不能超过 30 MiB");
  }
}

export async function validateImageFile(file: File): Promise<ValidatedImageFile> {
  if (file.size <= 0) throw invalidAttachment("截图文件不能为空");
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw invalidAttachment(`${file.name || "截图"} 不能超过 10 MiB`);
  }

  const bytes = new Uint8Array(
    await file.slice(0, MAX_ATTACHMENT_SIZE_BYTES + 1).arrayBuffer(),
  );
  if (bytes.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    throw invalidAttachment(`${file.name || "截图"} 不能超过 10 MiB`);
  }

  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !isSupportedMimeType(detected.mime)) {
    throw invalidAttachment(`${file.name || "截图"} 不是受支持的 PNG、JPEG 或 WebP 图片`);
  }
  if (file.type && file.type.toLowerCase() !== detected.mime) {
    throw invalidAttachment(`${file.name || "截图"} 的文件类型与内容不一致`);
  }

  return {
    originalName: file.name || "screenshot",
    mimeType: detected.mime,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}
