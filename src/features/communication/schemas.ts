import { z } from "zod";

const requestIdSchema = z.number().int().positive();
const expectedVersionSchema = z.number().int().positive();
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1, "幂等键不能为空")
  .max(128, "幂等键过长");
const communicationContentSchema = z
  .string()
  .trim()
  .min(1, "内容不能为空")
  .max(10_000, "内容不能超过 10000 个字符");

const appendCommunicationFields = {
  requestId: requestIdSchema,
  expectedVersion: expectedVersionSchema,
  content: communicationContentSchema,
  idempotencyKey: idempotencyKeySchema,
};

export const addPublicRemarkSchema = z
  .object(appendCommunicationFields)
  .strict();

export const saveOwnPrivateNoteSchema = z
  .object({
    requestId: requestIdSchema,
    expectedVersion: expectedVersionSchema,
    content: communicationContentSchema,
  })
  .strict();

export const clarificationMessageSchema = z
  .object(appendCommunicationFields)
  .strict();

export const communicationRequestSchema = z
  .object({ requestId: requestIdSchema })
  .strict();

export type AddPublicRemarkInput = z.input<typeof addPublicRemarkSchema>;
export type SaveOwnPrivateNoteInput = z.input<typeof saveOwnPrivateNoteSchema>;
export type ClarificationMessageInput = z.input<typeof clarificationMessageSchema>;
