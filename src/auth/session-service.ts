import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import { sessions, users } from "@/db/schema";
import type { AppDatabase, UserRole } from "@/db/types";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export type AuthenticatedUser = {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  mustChangePassword: boolean;
};

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(
  database: AppDatabase,
  userId: number,
  now = new Date(),
): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);

  database.db
    .insert(sessions)
    .values({
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt,
      createdAt: now,
      lastUsedAt: now,
    })
    .run();

  return { token, expiresAt };
}

export function getSessionUser(
  database: AppDatabase,
  token: string,
  now = new Date(),
): AuthenticatedUser | null {
  if (!token) return null;

  const row = database.db
    .select({
      sessionId: sessions.id,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        gt(sessions.expiresAt, now),
        eq(users.isActive, true),
      ),
    )
    .get();

  if (!row) return null;
  database.db
    .update(sessions)
    .set({ lastUsedAt: now })
    .where(eq(sessions.id, row.sessionId))
    .run();

  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    mustChangePassword: row.mustChangePassword,
  };
}

export function revokeSession(database: AppDatabase, token: string): void {
  if (!token) return;
  database.db
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .run();
}

export function revokeUserSessions(database: AppDatabase, userId: number): void {
  database.db.delete(sessions).where(eq(sessions.userId, userId)).run();
}
