import { createHash } from "node:crypto";

import { and, eq, lte } from "drizzle-orm";

import { authThrottle } from "@/db/schema";
import type { AppDatabase } from "@/db/types";

export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_SOURCE_ATTEMPT_LIMIT = 25;
export const LOGIN_THROTTLE_WINDOW_MS = 15 * 60 * 1_000;
export const LOGIN_THROTTLE_MAX_ROWS = 10_000;
export const LOGIN_THROTTLE_SOURCE_KEY = ":source:";

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

function sourceThrottleKey(source: string) {
  return {
    normalizedUsername: LOGIN_THROTTLE_SOURCE_KEY,
    sourceHash: hashLoginSource(source),
  };
}

function findThrottleRow(
  database: AppDatabase,
  key: { normalizedUsername: string; sourceHash: string },
) {
  return database.db
    .select()
    .from(authThrottle)
    .where(
      and(
        eq(authThrottle.normalizedUsername, key.normalizedUsername),
        eq(authThrottle.sourceHash, key.sourceHash),
      ),
    )
    .get();
}

function recordReservedAttempt(
  database: AppDatabase,
  key: { normalizedUsername: string; sourceHash: string },
  current: ReturnType<typeof findThrottleRow>,
  now: Date,
): void {
  if (!current) {
    database.db
      .insert(authThrottle)
      .values({ ...key, failureCount: 1, windowStartedAt: now, updatedAt: now })
      .run();
    return;
  }

  database.db
    .update(authThrottle)
    .set({ failureCount: current.failureCount + 1, updatedAt: now })
    .where(
      and(
        eq(authThrottle.normalizedUsername, key.normalizedUsername),
        eq(authThrottle.sourceHash, key.sourceHash),
      ),
    )
    .run();
}

export function isLoginThrottled(
  database: AppDatabase,
  username: string,
  source: string,
  now = new Date(),
): boolean {
  const key = throttleKey(username, source);
  const row = findThrottleRow(database, key);
  const sourceRow = findThrottleRow(database, sourceThrottleKey(source));

  return Boolean(
    (row &&
      now.getTime() - row.windowStartedAt.getTime() < LOGIN_THROTTLE_WINDOW_MS &&
      row.failureCount >= LOGIN_FAILURE_LIMIT) ||
      (sourceRow &&
        now.getTime() - sourceRow.windowStartedAt.getTime() <
          LOGIN_THROTTLE_WINDOW_MS &&
        sourceRow.failureCount >= LOGIN_SOURCE_ATTEMPT_LIMIT),
  );
}

export function reserveLoginAttempt(
  database: AppDatabase,
  username: string,
  source: string,
  now = new Date(),
): boolean {
  const key = throttleKey(username, source);
  const sourceKey = sourceThrottleKey(source);

  return database.sqlite.transaction(() => {
    const cutoff = new Date(now.getTime() - LOGIN_THROTTLE_WINDOW_MS);
    database.db
      .delete(authThrottle)
      .where(lte(authThrottle.windowStartedAt, cutoff))
      .run();

    const row = findThrottleRow(database, key);
    const sourceRow = findThrottleRow(database, sourceKey);
    if (row && row.failureCount >= LOGIN_FAILURE_LIMIT) return false;
    if (sourceRow && sourceRow.failureCount >= LOGIN_SOURCE_ATTEMPT_LIMIT) {
      return false;
    }

    const requiredRows = Number(!row) + Number(!sourceRow);
    if (requiredRows > 0) {
      const total = database.sqlite
        .prepare("select count(*) as total from auth_throttle")
        .get() as { total: number };
      if (total.total + requiredRows > LOGIN_THROTTLE_MAX_ROWS) return false;
    }

    recordReservedAttempt(database, sourceKey, sourceRow, now);
    recordReservedAttempt(database, key, row, now);

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
