import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "用户名至少需要 3 个字符")
  .max(32, "用户名最多允许 32 个字符")
  .regex(/^[a-z0-9._-]+$/, "用户名只能包含 ASCII 字母、数字、点、下划线和连字符");

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符`)
  .max(PASSWORD_MAX_LENGTH, `密码最多允许 ${PASSWORD_MAX_LENGTH} 个字符`);

export const loginPasswordSchema = z
  .string()
  .min(1)
  .max(PASSWORD_MAX_LENGTH);

export const loginCredentialsSchema = z
  .object({
    username: usernameSchema,
    password: loginPasswordSchema,
  })
  .strict();
