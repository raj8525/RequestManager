import { z } from "zod";

import {
  passwordSchema,
  usernameSchema,
} from "@/auth/credential-policy";

export { passwordSchema, usernameSchema } from "@/auth/credential-policy";

const displayNameSchema = z.string().trim().min(1, "显示名不能为空");
const userIdSchema = z.number().int().positive();
export const userRoleSchema = z.enum(["CUSTOMER", "DEVELOPER"]);

export const createUserSchema = z
  .object({
    username: usernameSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
    role: userRoleSchema,
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
