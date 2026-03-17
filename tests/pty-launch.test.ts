import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLaunchSpec,
  isCommandAvailable,
  sanitizeEnv,
  type LaunchResolverDeps,
} from "../electron/pty-launch.ts";

function createDeps(overrides: Partial<LaunchResolverDeps> = {}): LaunchResolverDeps {
  return {
    platform: "darwin",
    pathDelimiter: ":",
    pathSeparator: "/",
    existsSync: (file) =>
      [
        "/bin/zsh",
        "/usr/bin/git",
        "/opt/homebrew/bin/codex",
        "/Users/test/bin/custom",
      ].includes(file),
    isExecutable: (file) =>
      [
        "/bin/zsh",
        "/usr/bin/git",
        "/opt/homebrew/bin/codex",
        "/Users/test/bin/custom",
      ].includes(file),
    getShellEnv: async () => ({
      HOME: "/Users/test",
      PATH: "/opt/homebrew/bin:/usr/bin:/bin",
      SHELL: "/Users/test/bin/missing-shell",
    }),
    ...overrides,
  };
}

test("sanitizeEnv drops undefined values and injects a fallback PATH", () => {
  const env = sanitizeEnv(
    {
      HOME: "/Users/test",
      PATH: undefined,
      SHELL: undefined,
      LANG: "en_US.UTF-8",
    },
    createDeps(),
  );

  assert.equal(env.HOME, "/Users/test");
  assert.equal(env.LANG, "en_US.UTF-8");
  assert.ok(!("SHELL" in env));
  assert.match(env.PATH, /\/usr\/bin/);
});

test("buildLaunchSpec falls back to a real login shell when SHELL is invalid", async () => {
  const launch = await buildLaunchSpec(
    {
      cwd: "/repo",
    },
    createDeps({
      existsSync: (file) => ["/bin/zsh", "/repo"].includes(file),
      isExecutable: (file) => ["/bin/zsh"].includes(file),
    }),
  );

  assert.equal(launch.file, "/bin/zsh");
  assert.deepEqual(launch.args, ["-l"]);
  assert.match(launch.env.PATH, /\/usr\/bin/);
});

test("buildLaunchSpec resolves bare CLI commands from PATH", async () => {
  const launch = await buildLaunchSpec(
    {
      cwd: "/repo",
      shell: "codex",
      args: ["resume", "abc123"],
    },
    createDeps({
      existsSync: (file) =>
        ["/repo", "/opt/homebrew/bin/codex", "/bin/zsh"].includes(file),
    }),
  );

  assert.equal(launch.file, "/opt/homebrew/bin/codex");
  assert.deepEqual(launch.args, ["resume", "abc123"]);
});

test("buildLaunchSpec prepends extraPathEntries to PATH", async () => {
  const launch = await buildLaunchSpec(
    {
      cwd: "/repo",
      extraPathEntries: ["/app/cli"],
    },
    createDeps({
      existsSync: (file) => ["/bin/zsh", "/repo"].includes(file),
      isExecutable: (file) => ["/bin/zsh"].includes(file),
    }),
  );

  const entries = launch.env.PATH.split(":");
  assert.equal(entries[0], "/app/cli");
});

test("buildLaunchSpec does not duplicate extraPathEntries already in PATH", async () => {
  const launch = await buildLaunchSpec(
    {
      cwd: "/repo",
      extraPathEntries: ["/opt/homebrew/bin"],
    },
    createDeps({
      existsSync: (file) => ["/bin/zsh", "/repo"].includes(file),
      isExecutable: (file) => ["/bin/zsh"].includes(file),
    }),
  );

  const entries = launch.env.PATH.split(":");
  const count = entries.filter((e) => e === "/opt/homebrew/bin").length;
  assert.equal(count, 1);
});

test("buildLaunchSpec throws a clear error when a CLI executable cannot be resolved", async () => {
  await assert.rejects(
    () =>
      buildLaunchSpec(
        {
          cwd: "/repo",
          shell: "codex",
        },
        createDeps({
          existsSync: (file) => file === "/repo" || file === "/bin/zsh",
        }),
      ),
    /Executable not found: codex/,
  );
});

test("isCommandAvailable resolves commands from extra PATH entries", async () => {
  const available = await isCommandAvailable(
    "hydra",
    { extraPathEntries: ["/app/cli"] },
    createDeps({
      existsSync: (file) =>
        ["/app/cli/hydra", "/opt/homebrew/bin/codex", "/bin/zsh"].includes(file),
      isExecutable: (file) =>
        ["/app/cli/hydra", "/opt/homebrew/bin/codex", "/bin/zsh"].includes(file),
    }),
  );

  assert.equal(available, true);
});

test("isCommandAvailable returns false when the command cannot be resolved", async () => {
  const available = await isCommandAvailable(
    "hydra",
    undefined,
    createDeps({
      existsSync: (file) => ["/opt/homebrew/bin/codex", "/bin/zsh"].includes(file),
      isExecutable: (file) => ["/opt/homebrew/bin/codex", "/bin/zsh"].includes(file),
    }),
  );

  assert.equal(available, false);
});
