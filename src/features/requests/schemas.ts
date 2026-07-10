import { z } from "zod";

import {
  requestPriorities,
  requestProgressStatuses,
  requestRecordStatuses,
  requestTypes,
} from "@/db/schema";

import {
  DEFAULT_REQUEST_PAGE_SIZE,
  MAX_REQUEST_PAGE_SIZE,
  REQUEST_CONTENT_MAX_LENGTH,
  REQUEST_CONTENT_MIN_LENGTH,
} from "./constants";

const requestIdSchema = z.number().int().positive();
const expectedVersionSchema = z.number().int().positive();
const contentSchema = z
  .string()
  .trim()
  .min(REQUEST_CONTENT_MIN_LENGTH, "需求正文至少需要 10 个字符")
  .max(REQUEST_CONTENT_MAX_LENGTH, "需求正文不能超过 10000 个字符");
const requestTypeSchema = z.enum(requestTypes);
const prioritySchema = z.enum(requestPriorities);
const progressStatusSchema = z.enum(requestProgressStatuses);
const recordStatusSchema = z.enum(requestRecordStatuses);
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1, "幂等键不能为空")
  .max(128, "幂等键过长");

export const createRequestSchema = z
  .object({
    projectId: requestIdSchema,
    content: contentSchema,
    requestType: requestTypeSchema,
    priority: prioritySchema.optional().default("NORMAL"),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const updateOwnRequestSchema = z
  .object({
    requestId: requestIdSchema,
    expectedVersion: expectedVersionSchema,
    content: contentSchema,
    requestType: requestTypeSchema,
    priority: prioritySchema,
  })
  .strict();

export const changeProgressSchema = z
  .object({
    requestId: requestIdSchema,
    expectedVersion: expectedVersionSchema,
    progressStatus: progressStatusSchema,
  })
  .strict();

export const requestLifecycleSchema = z
  .object({
    requestId: requestIdSchema,
    expectedVersion: expectedVersionSchema,
  })
  .strict();

export const requestDetailSchema = z
  .object({ requestId: requestIdSchema })
  .strict();

export const listRequestsSchema = z
  .object({
    search: z.string().trim().max(200, "搜索内容过长").optional(),
    projectId: requestIdSchema.optional(),
    requestType: requestTypeSchema.optional(),
    priority: prioritySchema.optional(),
    progressStatus: progressStatusSchema.optional(),
    recordStatus: recordStatusSchema.optional(),
    page: z.number().int().positive().optional().default(1),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(MAX_REQUEST_PAGE_SIZE)
      .optional()
      .default(DEFAULT_REQUEST_PAGE_SIZE),
  })
  .strict();

export type CreateRequestInput = z.input<typeof createRequestSchema>;
export type UpdateOwnRequestInput = z.input<typeof updateOwnRequestSchema>;
export type ChangeProgressInput = z.input<typeof changeProgressSchema>;
export type RequestLifecycleInput = z.input<typeof requestLifecycleSchema>;
export type ListRequestsInput = z.input<typeof listRequestsSchema>;
