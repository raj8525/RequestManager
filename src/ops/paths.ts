import { existsSync, lstatSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, parse, relative, resolve, sep } from "node:path";

const STORAGE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const PROTECTED_SYSTEM_TREES = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/Library",
  "/private/etc",
  "/proc",
  "/root",
  "/sbin",
  "/System",
  "/usr",
].map((path) => resolve(path));

function dangerousDirectories(): Set<string> {
  return new Set([
    resolve(parse(resolve("/")).root),
    resolve(homedir()),
    resolve(tmpdir()),
    resolve(process.cwd()),
    resolve("/private"),
    resolve("/Users"),
    resolve("/var"),
    resolve("/Volumes"),
  ]);
}

function isWithinPath(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`))
  );
}

export function assertSafeManagedPath(path: string, label: string): string {
  if (!path.trim()) throw new Error(`${label} path is required`);
  const resolved = resolve(path);
  if (
    parse(resolved).root === resolved ||
    dangerousDirectories().has(resolved) ||
    PROTECTED_SYSTEM_TREES.some((path) => isWithinPath(path, resolved))
  ) {
    throw new Error(`${label} points to a dangerous shared directory`);
  }
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link`);
  }
  return resolved;
}

export function assertSafeManagedFilePath(path: string, label: string): string {
  const resolved = assertSafeManagedPath(path, label);
  const parent = dirname(resolved);
  if (parse(parent).root === parent || dangerousDirectories().has(parent)) {
    throw new Error(`${label} has a dangerous parent directory`);
  }
  return resolved;
}

export function isPathInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return (
    pathFromParent !== "" &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`)
  );
}

export function assertIndependentPaths(
  first: string,
  firstLabel: string,
  second: string,
  secondLabel: string,
): void {
  const resolvedFirst = resolve(first);
  const resolvedSecond = resolve(second);
  if (
    resolvedFirst === resolvedSecond ||
    isPathInside(resolvedFirst, resolvedSecond) ||
    isPathInside(resolvedSecond, resolvedFirst)
  ) {
    throw new Error(`${firstLabel} and ${secondLabel} must use independent paths`);
  }
}

export function assertStorageName(storageName: string): string {
  if (!STORAGE_NAME_PATTERN.test(storageName)) {
    throw new Error("invalid attachment storage name");
  }
  return storageName;
}

export function attachmentRelativePath(storageName: string): string {
  const safeName = assertStorageName(storageName);
  return `attachments/${safeName.slice(0, 2)}/${safeName}`;
}

export function liveAttachmentPath(
  uploadsPath: string,
  storageName: string,
): string {
  const safeName = assertStorageName(storageName);
  return resolve(uploadsPath, safeName.slice(0, 2), safeName);
}
