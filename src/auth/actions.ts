import { and, eq, gt, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect as nextRedirect } from "next/navigation";

import {
  loginCredentialsSchema,
  loginPasswordSchema,
  passwordSchema,
} from "@/auth/credential-policy";
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  setSessionCookie,
  type SessionCookieStore,
} from "@/auth/current-user";
import { hashPassword, verifyPassword } from "@/auth/password";
import {
  createSession,
  getSessionUser,
  hashSessionToken,
  revokeUserSessions,
} from "@/auth/session-service";
import {
  clearLoginFailures,
  reserveLoginAttempt,
} from "@/auth/throttle";
import { sessions, users } from "@/db/schema";
import type { AppDatabase } from "@/db/types";
import {
  actionFailure,
  actionSuccess,
  type ActionResult,
} from "@/lib/action-result";
import { assertSameOrigin } from "@/lib/csrf";
import { getEnvironment } from "@/lib/env";

export const GENERIC_LOGIN_ERROR = "用户名或密码错误";
export const UNTRUSTED_PROXY_SOURCE_BUCKET = "untrusted-proxy-shared-bucket";

type LoginInput = { username: string; password: string } | FormData;
type PasswordInput =
  | { oldPassword: string; newPassword: string }
  | FormData;

export type AuthActionContext = {
  headers?: Headers;
  cookies?: SessionCookieStore;
  now?: Date;
  appOrigin?: string;
  secureCookies?: boolean;
  trustProxyHeaders?: boolean;
  source?: string;
  redirect?: (path: string) => void;
};

type ResolvedContext = {
  headers: Headers;
  cookies: SessionCookieStore;
  now: Date;
  appOrigin: string;
  secureCookies: boolean;
  source: string;
  redirect?: (path: string) => void;
};

function inputValue(input: FormData | Record<string, string>, key: string): string {
  if (input instanceof FormData) {
    const value = input.get(key);
    return typeof value === "string" ? value : "";
  }
  return input[key] ?? "";
}

function sourceFromHeaders(
  requestHeaders: Headers,
  trustProxyHeaders: boolean,
): string {
  if (!trustProxyHeaders) return UNTRUSTED_PROXY_SOURCE_BUCKET;

  return (
    requestHeaders.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    requestHeaders.get("x-real-ip")?.trim() ||
    UNTRUSTED_PROXY_SOURCE_BUCKET
  );
}

async function resolveContext(context: AuthActionContext = {}): Promise<ResolvedContext> {
  const environment = getEnvironment();
  const requestHeaders = context.headers ?? (await headers());
  const trustProxyHeaders =
    context.trustProxyHeaders ?? environment.trustProxyHeaders;
  return {
    headers: requestHeaders,
    cookies: context.cookies ?? ((await cookies()) as SessionCookieStore),
    now: context.now ?? new Date(),
    appOrigin: context.appOrigin ?? environment.appOrigin,
    secureCookies: context.secureCookies ?? environment.secureCookies,
    source:
      context.source ?? sourceFromHeaders(requestHeaders, trustProxyHeaders),
    redirect: context.redirect,
  };
}

export async function loginAction(
  database: AppDatabase,
  input: LoginInput,
  context?: AuthActionContext,
): Promise<ActionResult<{ mustChangePassword: boolean }>> {
  const resolved = await resolveContext(context);
  assertSameOrigin(resolved.headers, resolved.appOrigin);

  const credentials = loginCredentialsSchema.safeParse({
    username: inputValue(input, "username"),
    password: inputValue(input, "password"),
  });
  if (!credentials.success) {
    return actionFailure("INVALID_CREDENTIALS", GENERIC_LOGIN_ERROR);
  }
  const { username, password } = credentials.data;
  if (!reserveLoginAttempt(database, username, resolved.source, resolved.now)) {
    return actionFailure("INVALID_CREDENTIALS", GENERIC_LOGIN_ERROR);
  }

  const user = database.db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${username}`)
    .get();
  const passwordMatches = user
    ? await verifyPassword(password, user.passwordHash)
    : (await hashPassword(password), false);

  if (!user || !user.isActive || !passwordMatches) {
    return actionFailure("INVALID_CREDENTIALS", GENERIC_LOGIN_ERROR);
  }

  clearLoginFailures(database, username, resolved.source);
  const session = createSession(database, user.id, resolved.now);
  setSessionCookie(
    resolved.cookies,
    session.token,
    session.expiresAt,
    resolved.secureCookies,
  );
  return actionSuccess({ mustChangePassword: user.mustChangePassword });
}

export async function logoutAction(
  database: AppDatabase,
  context?: AuthActionContext,
): Promise<ActionResult<null>> {
  const resolved = await resolveContext(context);
  assertSameOrigin(resolved.headers, resolved.appOrigin);

  const token = resolved.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const actor = getSessionUser(database, token, resolved.now);
    if (actor) revokeUserSessions(database, actor.id);
  }
  clearSessionCookie(resolved.cookies, resolved.secureCookies);
  return actionSuccess(null);
}

export async function changeOwnPasswordAction(
  database: AppDatabase,
  input: PasswordInput,
  context?: AuthActionContext,
): Promise<ActionResult<{ redirectTo: "/login" }>> {
  const resolved = await resolveContext(context);
  assertSameOrigin(resolved.headers, resolved.appOrigin);

  const token = resolved.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");
  const actor = getSessionUser(database, token, resolved.now);
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");

  const oldPassword = inputValue(input, "oldPassword");
  const newPassword = inputValue(input, "newPassword");
  const parsedNewPassword = passwordSchema.safeParse(newPassword);
  if (!parsedNewPassword.success) {
    return actionFailure("INVALID_INPUT", "新密码不符合要求", {
      newPassword: parsedNewPassword.error.issues.map((issue) => issue.message),
    });
  }
  if (!loginPasswordSchema.safeParse(oldPassword).success) {
    return actionFailure("INVALID_CURRENT_PASSWORD", "当前密码错误");
  }

  const user = database.db.select().from(users).where(eq(users.id, actor.id)).get();
  if (!user || !(await verifyPassword(oldPassword, user.passwordHash))) {
    return actionFailure("INVALID_CURRENT_PASSWORD", "当前密码错误");
  }

  const expectedPasswordHash = user.passwordHash;
  const passwordHash = await hashPassword(parsedNewPassword.data);
  const committed = database.sqlite.transaction(() => {
    const current = database.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(sessions, eq(sessions.userId, users.id))
      .where(
        and(
          eq(users.id, actor.id),
          eq(users.isActive, true),
          eq(users.passwordHash, expectedPasswordHash),
          eq(sessions.tokenHash, hashSessionToken(token)),
          gt(sessions.expiresAt, resolved.now),
        ),
      )
      .get();
    if (!current) return false;

    const updated = database.db
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        updatedAt: resolved.now,
      })
      .where(
        and(
          eq(users.id, actor.id),
          eq(users.isActive, true),
          eq(users.passwordHash, expectedPasswordHash),
        ),
      )
      .run();
    if (updated.changes !== 1) return false;
    revokeUserSessions(database, actor.id);
    return true;
  }).immediate();

  if (!committed) {
    clearSessionCookie(resolved.cookies, resolved.secureCookies);
    return actionFailure("CONFLICT", "账号状态已变化，请重新登录后再试");
  }

  clearSessionCookie(resolved.cookies, resolved.secureCookies);
  const result = actionSuccess({ redirectTo: "/login" as const });
  if (resolved.redirect) {
    resolved.redirect("/login");
    return result;
  }
  nextRedirect("/login");
}
