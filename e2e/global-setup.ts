import { access } from "node:fs/promises";
import path from "node:path";

export default async function globalSetup(): Promise<void> {
  await access(path.resolve("e2e/fixtures/screenshot.png"));
}
