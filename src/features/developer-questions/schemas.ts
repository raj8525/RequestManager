import { z } from "zod";

export const questionContentSchema = z.string().trim().min(1, "正文不能为空").max(10_000, "正文不能超过 10000 个字符");
const key = z.string().trim().min(1).max(128);

export const createDeveloperQuestionSchema = z.object({
  projectId: z.number().int().positive(),
  content: questionContentSchema,
  idempotencyKey: key,
});

export const appendDeveloperQuestionMessageSchema = z.object({
  questionId: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  content: questionContentSchema,
  idempotencyKey: key,
});

export const markDeveloperQuestionSeenSchema = z.object({
  questionId: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
});

export type CreateDeveloperQuestionInput = z.input<typeof createDeveloperQuestionSchema>;
export type AppendDeveloperQuestionMessageInput = z.input<typeof appendDeveloperQuestionMessageSchema>;
export type MarkDeveloperQuestionSeenInput = z.input<typeof markDeveloperQuestionSeenSchema>;
