import { z } from "zod";

const projectIdSchema = z.number().int().positive();
const codeSchema = z.string().trim().min(1, "项目编号不能为空");
const nameSchema = z.string().trim().min(1, "项目名称不能为空");
const descriptionSchema = z.string().trim();

export const createProjectSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    description: descriptionSchema.optional().default(""),
  })
  .strict();

export const updateProjectSchema = z
  .object({
    projectId: projectIdSchema,
    code: codeSchema.optional(),
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.code !== undefined ||
      input.name !== undefined ||
      input.description !== undefined,
    { message: "至少需要修改一项项目信息" },
  );

export const setProjectActiveSchema = z
  .object({
    projectId: projectIdSchema,
    active: z.boolean(),
  })
  .strict();

export type CreateProjectInput = z.input<typeof createProjectSchema>;
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;
export type SetProjectActiveInput = z.input<typeof setProjectActiveSchema>;
