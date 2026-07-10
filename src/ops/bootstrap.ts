import { sql } from "drizzle-orm";
import { z } from "zod";

import { passwordSchema } from "@/auth/credential-policy";
import { hashPassword } from "@/auth/password";
import { closeDatabase, createDatabase } from "@/db/client";
import { users } from "@/db/schema";
import { usernameSchema } from "@/features/accounts/schemas";
import { assertSafeManagedFilePath } from "@/ops/paths";

const firstDeveloperSchema = z
  .object({
    username: usernameSchema,
    displayName: z.string().trim().min(1).max(128),
    password: passwordSchema,
  })
  .strict();

export type FirstDeveloperInput = z.input<typeof firstDeveloperSchema> & {
  databasePath: string;
};

export type InitializedDeveloper = {
  id: number;
  username: string;
  displayName: string;
};

export async function initializeFirstDeveloper(
  input: FirstDeveloperInput,
): Promise<InitializedDeveloper> {
  const databasePath = assertSafeManagedFilePath(
    input.databasePath,
    "database file",
  );
  const parsed = firstDeveloperSchema.parse({
    username: input.username,
    displayName: input.displayName,
    password: input.password,
  });
  const passwordHash = await hashPassword(parsed.password);
  const database = createDatabase(databasePath);
  try {
    return database.sqlite
      .transaction(() => {
        const enabledDeveloper = database.db
          .select({ id: users.id })
          .from(users)
          .where(sql`${users.role} = 'DEVELOPER' and ${users.isActive} = 1`)
          .get();
        if (enabledDeveloper) {
          throw new Error("an enabled developer already exists");
        }

        const duplicate = database.db
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.username}) = ${parsed.username}`)
          .get();
        if (duplicate) throw new Error("the bootstrap username is already in use");

        const now = new Date();
        const created = database.db
          .insert(users)
          .values({
            username: parsed.username,
            displayName: parsed.displayName,
            passwordHash,
            role: "DEVELOPER",
            isActive: true,
            mustChangePassword: true,
            createdAt: now,
            updatedAt: now,
          })
          .returning({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
          })
          .get();
        return created;
      })
      .immediate();
  } finally {
    closeDatabase(database);
  }
}
