import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  buildLaunchSpec,
  PtyLaunchError,
  sanitizeEnv,
  type LaunchResolverDeps,
} from "../electron/pty-launch.ts";

const HOME_CLI_PATH = path.posix.join("/opt/homebrew/bin", "codex");

function createDeps(overrides: Partial<LaunchResolverDeps> = {}): LaunchResolverDeps {
  return {
    platform: "darwin",
    pathDelimiter: ":",
    pathSeparator: "/",
    existsSync: (file) =>
      [
        "/bin/zsh",
        "/usr/bin/git",
        HOME_CLI_PATH,
        "/Users/test/bin/custom",
      ].includes(file),
    isExecutable: (file) =>
      [
        "/bin/zsh",
        "/usr/bin/git",
        HOME_CLI_PATH,
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

function createWindowsDeps(
  overrides: Partial<LaunchResolverDeps> = {},
): LaunchResolverDeps {
  return {
    platform: "win32",
    pathDelimiter: ";",
    pathSeparator: "\\",
    existsSync: (file) =>
      [
        "C:\\repo",
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\codex.exe",
        "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd",
      ].includes(file),
    isExecutable: (file) =>
      [
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\codex.exe",
        "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd",
      ].includes(file),
    getShellEnv: async () => ({
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      APPDATA: "C:\\Users\\test\\AppData\\Roaming",
      USERPROFILE: "C:\\Users\\test",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      Path: "",
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

test("sanitizeEnv reads Windows Path variables case-insensitively and appends common user bins", () => {
  const env = sanitizeEnv(
    {
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      APPDATA: "C:\\Users\\test\\AppData\\Roaming",
      USERPROFILE: "C:\\Users\\test",
      Path: "C:\\Tools",
    },
    createWindowsDeps(),
  );

  const entries = env.PATH.split(";");
  assert.equal(entries[0], "C:\\Tools");
  assert.ok(
    entries.includes("C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps"),
  );
  assert.ok(entries.includes("C:\\Users\\test\\AppData\\Roaming\\npm"));
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
        ["/repo", HOME_CLI_PATH, "/bin/zsh"].includes(file),
    }),
  );

  assert.equal(launch.file, HOME_CLI_PATH);
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

test("buildLaunchSpec injects dark theme hints into the PTY environment", async () => {
  const launch = await buildLaunchSpec(
    {
      cwd: "/repo",
      theme: "dark",
    },
    createDeps({
      existsSync: (file) => ["/bin/zsh", "/repo"].includes(file),
      isExecutable: (file) => ["/bin/zsh"].includes(file),
    }),
  );

  assert.equal(launch.env.TERMCANVAS_THEME, "dark");
  assert.equal(launch.env.COLORFGBG, "15;0");
});

test("buildLaunchSpec injects light theme hints into the PTY environment", async () => {
  const launch = await buildLaunchSpec(
    {
      cwd: "/repo",
      theme: "light",
    },
    createDeps({
      existsSync: (file) => ["/bin/zsh", "/repo"].includes(file),
      isExecutable: (file) => ["/bin/zsh"].includes(file),
    }),
  );

  assert.equal(launch.env.TERMCANVAS_THEME, "light");
  assert.equal(launch.env.COLORFGBG, "0;15");
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

test("buildLaunchSpec throws PtyLaunchError when a CLI executable cannot be resolved", async () => {
  try {
    await buildLaunchSpec(
      {
        cwd: "/repo",
        shell: "codex",
      },
      createDeps({
        existsSync: (file) => file === "/repo" || file === "/bin/zsh",
      }),
    );
    assert.fail("Expected PtyLaunchError");
  } catch (err) {
    assert.ok(err instanceof PtyLaunchError);
    assert.equal(err.code, "executable-not-found");
    assert.equal(err.command, "codex");
    assert.match(err.message, /codex/);
  }
});

test("buildLaunchSpec resolves Windows app aliases from fallback user paths", async () => {
  const launch = await buildLaunchSpec(
    {
      cwd: "C:\\repo",
      shell: "codex",
      args: ["resume", "session-42"],
    },
    createWindowsDeps({
      existsSync: (file) =>
        [
          "C:\\repo",
          "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\codex.exe",
        ].includes(file),
      isExecutable: (file) =>
        [
          "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\codex.exe",
        ].includes(file),
    }),
  );

  assert.equal(
    launch.file,
    "C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\codex.exe",
  );
  assert.deepEqual(launch.args, ["resume", "session-42"]);
});

test("buildLaunchSpec prefers the real .exe path over a Windows extensionless alias match", async () => {
  const launch = await buildLaunchSpec(
    {
      cwd: "C:\\repo",
      shell: "codex",
    },
    createWindowsDeps({
      existsSync: (file) =>
        [
          "C:\\repo",
          "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\app\\resources\\codex",
          "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\app\\resources\\codex.exe",
        ].includes(file),
      isExecutable: (file) =>
        [
          "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\app\\resources\\codex",
          "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\app\\resources\\codex.exe",
        ].includes(file),
      getShellEnv: async () => ({
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
        APPDATA: "C:\\Users\\test\\AppData\\Roaming",
        USERPROFILE: "C:\\Users\\test",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        PATH: "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\app\\resources",
      }),
    }),
  );

  assert.equal(
    launch.file,
    "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\app\\resources\\codex.exe",
  );
});

test("buildLaunchSpec wraps Windows .cmd launchers with cmd.exe", async () => {
  const launch = await buildLaunchSpec(
    {
      cwd: "C:\\repo",
      shell: "claude",
      args: ["--resume", "abc123"],
    },
    createWindowsDeps({
      existsSync: (file) =>
        [
          "C:\\repo",
          "C:\\Windows\\System32\\cmd.exe",
          "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd",
        ].includes(file),
      isExecutable: (file) =>
        [
          "C:\\Windows\\System32\\cmd.exe",
          "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd",
        ].includes(file),
      getShellEnv: async () => ({
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
        APPDATA: "C:\\Users\\test\\AppData\\Roaming",
        USERPROFILE: "C:\\Users\\test",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        PATH: "C:\\Users\\test\\AppData\\Roaming\\npm",
      }),
    }),
  );

  assert.equal(launch.file, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(launch.args, [
    "/d",
    "/s",
    "/c",
    "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd",
    "--resume",
    "abc123",
  ]);
});
