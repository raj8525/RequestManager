import { sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect as nextRedirect } from "next/navigation";

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
  revokeUserSessions,
} from "@/auth/session-service";
import {
  clearLoginFailures,
  isLoginThrottled,
  normalizeUsername,
  recordLoginFailure,
} from "@/auth/throttle";
import { users } from "@/db/schema";
import type { AppDatabase } from "@/db/types";
import {
  actionFailure,
  actionSuccess,
  type ActionResult,
} from "@/lib/action-result";
import { assertSameOrigin } from "@/lib/csrf";
import { getEnvironment } from "@/lib/env";

export const GENERIC_LOGIN_ERROR = "用户名或密码错误";

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

function sourceFromHeaders(requestHeaders: Headers): string {
  return (
    requestHeaders.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "unknown"
  );
}

async function resolveContext(context: AuthActionContext = {}): Promise<ResolvedContext> {
  const environment = getEnvironment();
  const requestHeaders = context.headers ?? (await headers());
  return {
    headers: requestHeaders,
    cookies: context.cookies ?? ((await cookies()) as SessionCookieStore),
    now: context.now ?? new Date(),
    appOrigin: context.appOrigin ?? environment.appOrigin,
    secureCookies: context.secureCookies ?? environment.secureCookies,
    source: context.source ?? sourceFromHeaders(requestHeaders),
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

  const username = normalizeUsername(inputValue(input, "username"));
  const password = inputValue(input, "password");
  if (isLoginThrottled(database, username, resolved.source, resolved.now)) {
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
    recordLoginFailure(database, username, resolved.source, resolved.now);
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
  const actor = token ? getSessionUser(database, token, resolved.now) : null;
  if (!actor) return actionFailure("UNAUTHENTICATED", "登录已过期，请重新登录");

  const oldPassword = inputValue(input, "oldPassword");
  const newPassword = inputValue(input, "newPassword");
  if (!newPassword) {
    return actionFailure("INVALID_INPUT", "请输入新密码", {
      newPassword: ["请输入新密码"],
    });
  }

  const user = database.db.select().from(users).where(sql`${users.id} = ${actor.id}`).get();
  if (!user || !(await verifyPassword(oldPassword, user.passwordHash))) {
    return actionFailure("INVALID_CURRENT_PASSWORD", "当前密码错误");
  }

  const passwordHash = await hashPassword(newPassword);
  database.sqlite.transaction(() => {
    database.db
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        updatedAt: resolved.now,
      })
      .where(sql`${users.id} = ${actor.id}`)
      .run();
    revokeUserSessions(database, actor.id);
  })();

  clearSessionCookie(resolved.cookies, resolved.secureCookies);
  const result = actionSuccess({ redirectTo: "/login" as const });
  if (resolved.redirect) {
    resolved.redirect("/login");
    return result;
  }
  nextRedirect("/login");
}
