import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "用户名至少需要 3 个字符")
  .max(32, "用户名最多允许 32 个字符")
  .regex(/^[a-z0-9._-]+$/, "用户名只能包含 ASCII 字母、数字、点、下划线和连字符");

const displayNameSchema = z.string().trim().min(1, "显示名不能为空");
const passwordSchema = z.string().min(1, "密码不能为空");
const userIdSchema = z.number().int().positive();

export const createUserSchema = z
  .object({
    username: usernameSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
    role: z.enum(["CUSTOMER", "DEVELOPER"]),
  })
  .strict();

export const updateUserIdentitySchema = z
  .object({
    userId: userIdSchema,
    username: usernameSchema.optional(),
    displayName: displayNameSchema.optional(),
  })
  .strict()
  .refine((input) => input.username !== undefined || input.displayName !== undefined, {
    message: "至少需要修改一项账号信息",
  });

export const resetUserPasswordSchema = z
  .object({
    userId: userIdSchema,
    password: passwordSchema,
  })
  .strict();

export const setUserActiveSchema = z
  .object({
    userId: userIdSchema,
    active: z.boolean(),
  })
  .strict();

export const replaceCustomerMembershipsSchema = z
  .object({
    customerId: userIdSchema,
    projectIds: z.array(z.number().int().positive()),
  })
  .strict();

export type CreateUserInput = z.input<typeof createUserSchema>;
export type UpdateUserIdentityInput = z.input<typeof updateUserIdentitySchema>;
export type ResetUserPasswordInput = z.input<typeof resetUserPasswordSchema>;
export type SetUserActiveInput = z.input<typeof setUserActiveSchema>;
export type ReplaceCustomerMembershipsInput = z.input<
  typeof replaceCustomerMembershipsSchema
>;
