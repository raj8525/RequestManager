import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const script = resolve(root, "scripts/deploy-ubuntu.sh");
const temporaryDirectories: string[] = [];

function runScript(
  args: string[],
  options: { env?: Record<string, string>; stdin?: string } = {},
) {
  const sandbox = mkdtempSync(resolve(tmpdir(), "request-manager-deploy-test-"));
  temporaryDirectories.push(sandbox);
  const osRelease = resolve(sandbox, "os-release");
  writeFileSync(osRelease, 'ID="ubuntu"\nVERSION_CODENAME="noble"\n');
  const commandLog = resolve(sandbox, "commands.log");

  const result = spawnSync("bash", [script, ...args], {
    cwd: root,
    encoding: "utf8",
    input: options.stdin,
    env: {
      ...process.env,
      REQUEST_MANAGER_INSTALL_ROOT: resolve(sandbox, "opt/request-manager"),
      REQUEST_MANAGER_DATA_ROOT: resolve(sandbox, "var/lib/request-manager"),
      REQUEST_MANAGER_CONFIG_ROOT: resolve(sandbox, "etc/request-manager"),
      REQUEST_MANAGER_OS_RELEASE_FILE: osRelease,
      REQUEST_MANAGER_COMMAND_LOG: commandLog,
      ...options.env,
    },
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: readFileSync(commandLog, { encoding: "utf8", flag: "a+" })
      .split("\n")
      .filter(Boolean),
  };
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("Ubuntu deployment command", () => {
  test("prints the public commands without root", () => {
    const result = runScript(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("deploy");
    expect(result.stdout).toContain("sync SSH_TARGET");
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("logs");
  });

  test.each(["0", "65536", "abc", "13001;id"])(
    "rejects invalid port %s",
    (port) => {
      const result = runScript(["deploy", "--port", port], {
        env: { REQUEST_MANAGER_EFFECTIVE_UID: "0" },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("invalid port");
    },
  );

  test("rejects deploy outside Ubuntu", () => {
    const result = runScript(["deploy"], {
      env: {
        REQUEST_MANAGER_EFFECTIVE_UID: "0",
        REQUEST_MANAGER_OS_RELEASE_FILE: "/dev/null",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Ubuntu");
  });

  test("rejects credentials embedded in a repository URL without echoing them", () => {
    const secretUrl = "https://token@example.com/repo.git";
    const result = runScript(["deploy", "--repo", secretUrl], {
      env: { REQUEST_MANAGER_EFFECTIVE_UID: "0" },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(secretUrl);
  });

  test("rejects an unsafe SSH target before running remote commands", () => {
    const result = runScript(["sync", "root@example.com;id"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid SSH target");
    expect(result.calls).toEqual([]);
  });
});

describe("deployment safety contract", () => {
  const source = readFileSync(script, "utf8");

  test("builds and backs up before stopping an existing service", () => {
    const body = source.slice(
      source.indexOf("deploy_server()"),
      source.indexOf("sync_to_server()"),
    );

    expect(body.indexOf("build_revision_image")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("backup_existing_service")).toBeGreaterThan(
      body.indexOf("build_revision_image"),
    );
    expect(body.indexOf('docker stop "${CONTAINER_NAME}"')).toBeGreaterThan(
      body.indexOf("backup_existing_service"),
    );
  });

  test("contains an old-image restore path for failed upgrades", () => {
    expect(source).toContain("rollback_release");
    expect(source).toContain("npm run ops:restore --");
    expect(source).toContain("--confirm-restore");
    expect(source).toContain("--app-stopped");
  });

  test("sync uses a complete application backup before SSH and scp", () => {
    const body = source.slice(source.indexOf("sync_to_server()"));

    expect(body.indexOf("npm run ops:backup")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("remote_deploy")).toBeGreaterThan(
      body.indexOf("npm run ops:backup"),
    );
    expect(body.indexOf("scp")).toBeGreaterThan(body.indexOf("remote_deploy"));
    expect(body).not.toContain("request-manager.db-wal");
  });

  test("never disables SSH host-key verification or evaluates generated text", () => {
    expect(source).not.toContain("StrictHostKeyChecking=no");
    expect(source).not.toMatch(/\beval\b/);
  });
});
