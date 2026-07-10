import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/auth/password";

describe("password hashing", () => {
  it("stores a salted scrypt hash and verifies it with the encoded parameters", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(first).not.toBe(second);
    await expect(
      verifyPassword("correct horse battery staple", first),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong password", first)).resolves.toBe(false);
  });

  it("rejects malformed or unsupported password encodings", async () => {
    await expect(verifyPassword("password", "not-a-hash")).resolves.toBe(false);
    await expect(
      verifyPassword("password", "scrypt$1$8$1$invalid$invalid"),
    ).resolves.toBe(false);
  });
});
