import { cookies } from "next/headers";

import { getSessionUser, type AuthenticatedUser } from "@/auth/session-service";
import type { AppDatabase } from "@/db/types";
import { getEnvironment } from "@/lib/env";

export const SESSION_COOKIE_NAME = "request_manager_session";

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  expires: Date;
};

export type SessionCookieStore = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: SessionCookieOptions): void;
};

export function sessionCookieOptions(
  expires: Date,
  secure = getEnvironment().secureCookies,
): SessionCookieOptions {
  return { httpOnly: true, sameSite: "lax", path: "/", secure, expires };
}

export function setSessionCookie(
  cookieStore: SessionCookieStore,
  token: string,
  expiresAt: Date,
  secure?: boolean,
): void {
  cookieStore.set(
    SESSION_COOKIE_NAME,
    token,
    sessionCookieOptions(expiresAt, secure),
  );
}

export function clearSessionCookie(
  cookieStore: SessionCookieStore,
  secure?: boolean,
): void {
  cookieStore.set(
    SESSION_COOKIE_NAME,
    "",
    sessionCookieOptions(new Date(0), secure),
  );
}

export async function getCurrentUser(
  database: AppDatabase,
  cookieStore?: Pick<SessionCookieStore, "get">,
  now = new Date(),
): Promise<AuthenticatedUser | null> {
  const resolvedCookies = cookieStore ?? (await cookies());
  const token = resolvedCookies.get(SESSION_COOKIE_NAME)?.value;
  return token ? getSessionUser(database, token, now) : null;
}
