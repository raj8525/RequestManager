import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { authThrottle } from "@/db/schema";
import type { AppDatabase } from "@/db/types";

export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_THROTTLE_WINDOW_MS = 15 * 60 * 1_000;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function hashLoginSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function throttleKey(username: string, source: string) {
  return {
    normalizedUsername: normalizeUsername(username),
    sourceHash: hashLoginSource(source),
  };
}

export function isLoginThrottled(
  database: AppDatabase,
  username: string,
  source: string,
  now = new Date(),
): boolean {
  const key = throttleKey(username, source);
  const row = database.db
    .select()
    .from(authThrottle)
    .where(
      and(
        eq(authThrottle.normalizedUsername, key.normalizedUsername),
        eq(authThrottle.sourceHash, key.sourceHash),
      ),
    )
    .get();

  return Boolean(
    row &&
      now.getTime() - row.windowStartedAt.getTime() < LOGIN_THROTTLE_WINDOW_MS &&
      row.failureCount >= LOGIN_FAILURE_LIMIT,
  );
}

export function reserveLoginAttempt(
  database: AppDatabase,
  username: string,
  source: string,
  now = new Date(),
): boolean {
  const key = throttleKey(username, source);

  return database.sqlite.transaction(() => {
    const row = database.db
      .select()
      .from(authThrottle)
      .where(
        and(
          eq(authThrottle.normalizedUsername, key.normalizedUsername),
          eq(authThrottle.sourceHash, key.sourceHash),
        ),
      )
      .get();
    const expired =
      !row ||
      now.getTime() - row.windowStartedAt.getTime() >= LOGIN_THROTTLE_WINDOW_MS;

    if (!expired && row.failureCount >= LOGIN_FAILURE_LIMIT) return false;

    if (!row) {
      database.db
        .insert(authThrottle)
        .values({ ...key, failureCount: 1, windowStartedAt: now, updatedAt: now })
        .run();
    } else {
      database.db
        .update(authThrottle)
        .set({
          failureCount: expired ? 1 : row.failureCount + 1,
          windowStartedAt: expired ? now : row.windowStartedAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(authThrottle.normalizedUsername, key.normalizedUsername),
            eq(authThrottle.sourceHash, key.sourceHash),
          ),
        )
        .run();
    }

    return true;
  }).immediate();
}

export function clearLoginFailures(
  database: AppDatabase,
  username: string,
  source: string,
): void {
  const key = throttleKey(username, source);
  database.db
    .delete(authThrottle)
    .where(
      and(
        eq(authThrottle.normalizedUsername, key.normalizedUsername),
        eq(authThrottle.sourceHash, key.sourceHash),
      ),
    )
    .run();
}
