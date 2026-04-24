import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
  buildLaunchSpec,
  PtyLaunchError,
  sanitizeEnv,
  sanitizeLoginShellSeedEnv,
  type LaunchResolverDeps,
} from "../electron/pty-launch.ts";
import { getTerminalExtraPathEntries } from "../electron/agent-shims.ts";

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
    readFileSync: () => {
      throw new Error("Unexpected readFileSync call");
    },
    homeDir: () => "/Users/test",
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
    readFileSync: () => {
      throw new Error("Unexpected readFileSync call");
    },
    homeDir: () => "C:\\Users\\test",
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

test("sanitizeLoginShellSeedEnv strips host session noise before login shell capture", () => {
  const env = sanitizeLoginShellSeedEnv(
    {
      HOME: "/Users/test",
      PATH: "/custom/bin:/usr/bin",
      NO_COLOR: "1",
      TERM_PROGRAM: "Apple_Terminal",
      TERM_PROGRAM_VERSION: "464",
      TERM_SESSION_ID: "session-123",
      CODEX_CI: "1",
      CODEX_THREAD_ID: "thread-123",
      P9K_TTY: "/dev/ttys001",
    },
    createDeps(),
  );

  assert.equal(env.HOME, "/Users/test");
  assert.equal(env.PATH, "/custom/bin:/usr/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/sbin:/sbin");
  assert.ok(!("NO_COLOR" in env));
  assert.ok(!("TERM_PROGRAM" in env));
  assert.ok(!("TERM_PROGRAM_VERSION" in env));
  assert.ok(!("TERM_SESSION_ID" in env));
  assert.ok(!("CODEX_CI" in env));
  assert.ok(!("CODEX_THREAD_ID" in env));
  assert.ok(!("P9K_TTY" in env));
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

test("buildLaunchSpec keeps login shell NO_COLOR when the shell explicitly exports it", async () => {
  const launch = await buildLaunchSpec(
    {
      cwd: "/repo",
    },
    createDeps({
      existsSync: (file) => ["/bin/zsh", "/repo"].includes(file),
      isExecutable: (file) => ["/bin/zsh"].includes(file),
      getShellEnv: async () => ({
        HOME: "/Users/test",
        PATH: "/opt/homebrew/bin:/usr/bin:/bin",
        SHELL: "/bin/zsh",
        NO_COLOR: "1",
      }),
    }),
  );

  assert.equal(launch.env.NO_COLOR, "1");
});

test("buildLaunchSpec injects TermCanvas instance routing into the PTY environment", async () => {
  const previousDevServerUrl = process.env.VITE_DEV_SERVER_URL;
  process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173";

  try {
    const launch = await buildLaunchSpec(
      {
        cwd: "/repo",
        terminalId: "terminal-42",
        terminalType: "codex",
      },
      createDeps({
        existsSync: (file) => ["/bin/zsh", "/repo"].includes(file),
        isExecutable: (file) => ["/bin/zsh"].includes(file),
      }),
    );

    assert.equal(launch.env.TERMCANVAS_TERMINAL_ID, "terminal-42");
    assert.equal(launch.env.TERMCANVAS_TERMINAL_TYPE, "codex");
    assert.equal(launch.env.TERMCANVAS_INSTANCE, "dev");
    assert.equal(
      launch.env.TERMCANVAS_PORT_FILE,
      path.join(os.homedir(), ".termcanvas-dev", "port"),
    );
  } finally {
    if (previousDevServerUrl === undefined) {
      delete process.env.VITE_DEV_SERVER_URL;
    } else {
      process.env.VITE_DEV_SERVER_URL = previousDevServerUrl;
    }
  }
});

test("buildLaunchSpec injects Computer Use MCP config into Codex argv", async () => {
  const stateFile = "/Users/test/.termcanvas/computer-use/state.json";
  const mcpServer = path.join(
    process.cwd(),
    "mcp",
    "computer-use-server",
    "dist",
    "index.js",
  );
  const instructionsFile = path.join(
    process.cwd(),
    "skills",
    "computer-use-instructions.md",
  );

  const launch = await buildLaunchSpec(
    {
      cwd: "/repo",
      shell: "codex",
      args: ["resume", "session-42"],
      terminalType: "codex",
    },
    createDeps({
      existsSync: (file) =>
        ["/repo", HOME_CLI_PATH, stateFile, mcpServer, instructionsFile].includes(file),
      isExecutable: (file) => [HOME_CLI_PATH].includes(file),
    }),
  );

  assert.deepEqual(launch.args.slice(0, 6), [
    "-c",
    'mcp_servers.computer-use.command="node"',
    "-c",
    `mcp_servers.computer-use.args=${JSON.stringify([mcpServer])}`,
    "-c",
    `mcp_servers.computer-use.env={ TERMCANVAS_COMPUTER_USE_STATE_FILE = ${JSON.stringify(stateFile)}, TERMCANVAS_COMPUTER_USE_INSTRUCTIONS = ${JSON.stringify(instructionsFile)} }`,
  ]);
  assert.deepEqual(launch.args.slice(6), ["resume", "session-42"]);
  assert.equal(launch.env.TERMCANVAS_COMPUTER_USE_ENABLED, "1");
  assert.equal(launch.env.TERMCANVAS_COMPUTER_USE_STATE_FILE, stateFile);
  assert.equal(launch.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS, instructionsFile);
  assert.equal("TERMCANVAS_CU_PORT" in launch.env, false);
  assert.equal("TERMCANVAS_CU_TOKEN" in launch.env, false);
  assert.equal("CODEX_MCP_SERVERS" in launch.env, false);
});

test("buildLaunchSpec injects Computer Use MCP config into Codex before helper is enabled", async () => {
  const stateFile = "/Users/test/.termcanvas/computer-use/state.json";
  const mcpServer = path.join(
    process.cwd(),
    "mcp",
    "computer-use-server",
    "dist",
    "index.js",
  );
  const instructionsFile = path.join(
    process.cwd(),
    "skills",
    "computer-use-instructions.md",
  );

  const launch = await buildLaunchSpec(
    {
      cwd: "/repo",
      shell: "codex",
      terminalType: "codex",
    },
    createDeps({
      existsSync: (file) =>
        ["/repo", HOME_CLI_PATH, mcpServer, instructionsFile].includes(file),
      isExecutable: (file) => [HOME_CLI_PATH].includes(file),
    }),
  );

  assert.deepEqual(launch.args.slice(0, 6), [
    "-c",
    'mcp_servers.computer-use.command="node"',
    "-c",
    `mcp_servers.computer-use.args=${JSON.stringify([mcpServer])}`,
    "-c",
    `mcp_servers.computer-use.env={ TERMCANVAS_COMPUTER_USE_STATE_FILE = ${JSON.stringify(stateFile)}, TERMCANVAS_COMPUTER_USE_INSTRUCTIONS = ${JSON.stringify(instructionsFile)} }`,
  ]);
  assert.equal(launch.env.TERMCANVAS_COMPUTER_USE_STATE_FILE, stateFile);
  assert.equal(launch.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS, instructionsFile);
  assert.equal("TERMCANVAS_COMPUTER_USE_ENABLED" in launch.env, false);
});

test("buildLaunchSpec injects Computer Use MCP config into Claude argv", async () => {
  const stateFile = "/Users/test/.termcanvas/computer-use/state.json";
  const mcpServer = path.join(
    process.cwd(),
    "mcp",
    "computer-use-server",
    "dist",
    "index.js",
  );
  const instructionsFile = path.join(
    process.cwd(),
    "skills",
    "computer-use-instructions.md",
  );

  const launch = await buildLaunchSpec(
    {
      cwd: "/repo",
      shell: "claude",
      args: ["--resume", "session-42"],
      terminalType: "claude",
    },
    createDeps({
      existsSync: (file) =>
        [
          "/repo",
          "/opt/homebrew/bin/claude",
          stateFile,
          mcpServer,
          instructionsFile,
        ].includes(file),
      isExecutable: (file) => ["/opt/homebrew/bin/claude"].includes(file),
    }),
  );

  assert.equal(launch.args[0], "--mcp-config");
  assert.deepEqual(JSON.parse(launch.args[1]), {
    mcpServers: {
      "termcanvas-computer-use": {
        command: "node",
        args: [mcpServer],
        env: {
          TERMCANVAS_COMPUTER_USE_STATE_FILE: stateFile,
          TERMCANVAS_COMPUTER_USE_INSTRUCTIONS: instructionsFile,
        },
      },
    },
  });
  assert.deepEqual(launch.args.slice(2), ["--resume", "session-42"]);
  assert.equal(launch.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS, instructionsFile);
  assert.equal("CLAUDE_MCP_SERVERS" in launch.env, false);
  assert.equal("TERMCANVAS_CU_TOKEN" in launch.env, false);
});

test("buildLaunchSpec exposes Computer Use state file to shell terminals without token", async () => {
  const stateFile = "/Users/test/.termcanvas/computer-use/state.json";
  const instructionsFile = path.join(
    process.cwd(),
    "skills",
    "computer-use-instructions.md",
  );

  const launch = await buildLaunchSpec(
    {
      cwd: "/repo",
      terminalType: "shell",
    },
    createDeps({
      existsSync: (file) =>
        ["/repo", "/bin/zsh", stateFile, instructionsFile].includes(file),
      isExecutable: (file) => ["/bin/zsh"].includes(file),
    }),
  );

  assert.equal(launch.env.TERMCANVAS_COMPUTER_USE_ENABLED, "1");
  assert.equal(launch.env.TERMCANVAS_COMPUTER_USE_STATE_FILE, stateFile);
  assert.equal(launch.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS, instructionsFile);
  assert.equal("TERMCANVAS_CU_TOKEN" in launch.env, false);
  assert.deepEqual(launch.args, ["-l"]);
});

test("buildLaunchSpec exposes Computer Use bootstrap env to shell terminals before helper is enabled", async () => {
  const stateFile = "/Users/test/.termcanvas/computer-use/state.json";
  const instructionsFile = path.join(
    process.cwd(),
    "skills",
    "computer-use-instructions.md",
  );

  const launch = await buildLaunchSpec(
    {
      cwd: "/repo",
      terminalType: "shell",
    },
    createDeps({
      existsSync: (file) => ["/repo", "/bin/zsh", instructionsFile].includes(file),
      isExecutable: (file) => ["/bin/zsh"].includes(file),
    }),
  );

  assert.equal(launch.env.TERMCANVAS_COMPUTER_USE_STATE_FILE, stateFile);
  assert.equal(launch.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS, instructionsFile);
  assert.equal("TERMCANVAS_COMPUTER_USE_ENABLED" in launch.env, false);
  assert.equal("TERMCANVAS_CU_TOKEN" in launch.env, false);
  assert.deepEqual(launch.args, ["-l"]);
});

test("shell terminal extra PATH entries put agent shims after cliDir for launch prepending", () => {
  const entries = getTerminalExtraPathEntries(
    "/Applications/TermCanvas.app/Contents/Resources/cli",
    "shell",
    (file) => file.endsWith("/agent-shims"),
  );

  assert.deepEqual(entries, [
    "/Applications/TermCanvas.app/Contents/Resources/cli",
    "/Applications/TermCanvas.app/Contents/Resources/cli/agent-shims",
  ]);
});

test("managed agent terminals do not receive shell agent shim PATH entries", () => {
  const entries = getTerminalExtraPathEntries(
    "/Applications/TermCanvas.app/Contents/Resources/cli",
    "codex",
    () => true,
  );

  assert.deepEqual(entries, [
    "/Applications/TermCanvas.app/Contents/Resources/cli",
  ]);
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
