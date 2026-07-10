import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  basename,
  dirname,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

const STORAGE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function canonicalProjection(path: string): string {
  let existingPath = resolve(path);
  const missingSegments: string[] = [];
  while (!existsSync(existingPath)) {
    const parent = dirname(existingPath);
    if (parent === existingPath) break;
    missingSegments.unshift(basename(existingPath));
    existingPath = parent;
  }
  const canonicalBase = existsSync(existingPath)
    ? realpathSync.native(existingPath)
    : existingPath;
  return resolve(canonicalBase, ...missingSegments);
}

function canonicalManagedPath(path: string, label: string): string {
  const resolved = resolve(path);
  const root = parse(resolved).root;
  let current = root;
  const relativeSegments = resolved
    .slice(root.length)
    .split(sep)
    .filter(Boolean);
  for (const segment of relativeSegments) {
    current = join(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} must not contain symbolic-link path components`);
    }
  }
  return canonicalProjection(resolved);
}

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
].map(canonicalProjection);

function dangerousDirectories(): Set<string> {
  return new Set([
    canonicalProjection(parse(resolve("/")).root),
    canonicalProjection(homedir()),
    canonicalProjection(tmpdir()),
    canonicalProjection(process.cwd()),
    canonicalProjection("/private"),
    canonicalProjection("/Users"),
    canonicalProjection("/var"),
    canonicalProjection("/Volumes"),
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
  const resolved = canonicalManagedPath(path, label);
  if (
    parse(resolved).root === resolved ||
    dangerousDirectories().has(resolved) ||
    PROTECTED_SYSTEM_TREES.some((path) => isWithinPath(path, resolved))
  ) {
    throw new Error(`${label} points to a dangerous shared directory`);
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
  const pathFromParent = relative(
    canonicalProjection(parent),
    canonicalProjection(candidate),
  );
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
  const resolvedFirst = canonicalManagedPath(first, firstLabel);
  const resolvedSecond = canonicalManagedPath(second, secondLabel);
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
