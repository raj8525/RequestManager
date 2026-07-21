import { z } from "zod";

export const saveCompletionNoteSchema = z.object({
  requestId: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  content: z.string().trim().max(10_000, "完成说明不能超过 10000 个字符"),
  retainedAttachmentIds: z.array(z.number().int().positive()).max(8),
  completeRequest: z.boolean(),
}).strict();

export type SaveCompletionNoteInput = z.input<typeof saveCompletionNoteSchema>;
