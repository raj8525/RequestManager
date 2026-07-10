export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 8;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 30 * 1024 * 1024;

export const SUPPORTED_ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type SupportedAttachmentMimeType =
  (typeof SUPPORTED_ATTACHMENT_MIME_TYPES)[number];
