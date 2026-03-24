import test from "node:test";
import assert from "node:assert/strict";

import {
  getProcessListCommand,
  parsePsOutput,
  splitCommandLine,
  parseWindowsProcessListOutput,
} from "../electron/process-detector.ts";

const HEADER = "  PID  PPID ARGS\n";

test("detects direct child claude process", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 claude\n";

  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 1);
  assert.equal(results[0].cliType, "claude");
  assert.equal(results[0].pid, 200);
});

test("detects node /path/to/claude as claude", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 node /usr/local/bin/claude --help\n";

  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 1);
  assert.equal(results[0].cliType, "claude");
});

test("detects bun /path/to/codex as codex", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 bun /home/user/.bun/bin/codex\n";

  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 1);
  assert.equal(results[0].cliType, "codex");
});

test("detects npx codex as codex", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 npx codex --flag\n";

  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 1);
  assert.equal(results[0].cliType, "codex");
});

test("detects bunx gemini as gemini", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 bunx gemini\n";

  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 1);
  assert.equal(results[0].cliType, "gemini");
});

test("non-CLI child (vim) returns empty result", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 vim somefile.txt\n";

  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 0);
});

test("detects grandchild CLI through intermediate process", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 bash\n" +
    "  300   200 claude\n";

  // Shell PID is 100 — claude (PID 300) is a grandchild via bash (PID 200)
  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 1);
  assert.equal(results[0].cliType, "claude");
  assert.equal(results[0].pid, 300);
});

test("detects CLI through volta/mise shim (deep nesting)", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 /Users/x/.volta/bin/claude\n" +
    "  300   200 node /Users/x/.volta/tools/image/packages/claude/cli.mjs\n";

  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 2);
  assert.equal(results[0].cliType, "claude");
  assert.equal(results[0].pid, 200);
});

test("shallowest match comes first in results", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 bash -c codex\n" +
    "  300   200 node /path/to/codex\n" +
    "  400   300 codex\n";

  const results = parsePsOutput(ps, [100]);
  assert.ok(results.length >= 1);
  assert.equal(results[0].cliType, "codex");
});

test("shallow direct child wins over deeper descendant regardless of PID order", () => {
  // PID 500 (claude, direct child) was started AFTER PID 300 (codex, grandchild)
  // so PID 500 > PID 300 in ps output, but claude is shallower and should win.
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 bash\n" +
    "  300   200 codex\n" +
    "  500   100 claude\n";

  const results = parsePsOutput(ps, [100]);
  assert.ok(results.length >= 2);
  // claude (depth 1) should come before codex (depth 2)
  assert.equal(results[0].cliType, "claude");
  assert.equal(results[0].pid, 500);
  assert.equal(results[1].cliType, "codex");
  assert.equal(results[1].pid, 300);
});

test("multiple shell PIDs with different children", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  101     1 /bin/bash\n" +
    "  200   100 claude\n" +
    "  300   101 codex\n";

  const results = parsePsOutput(ps, [100, 101]);
  assert.equal(results.length, 2);
  assert.equal(results[0].cliType, "claude");
  assert.equal(results[1].cliType, "codex");
});

test("detects tmux as direct child", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 tmux new -s main\n";

  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 1);
  assert.equal(results[0].cliType, "tmux");
});

test("detects lazygit", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 lazygit\n";

  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 1);
  assert.equal(results[0].cliType, "lazygit");
});

test("detects opencode", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 opencode\n";

  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 1);
  assert.equal(results[0].cliType, "opencode");
});

test("returns empty for no matching children", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   999 claude\n";

  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 0);
});

test("handles empty ps output", () => {
  const results = parsePsOutput("", [100]);
  assert.equal(results.length, 0);
});

test("node without CLI arg is not detected", () => {
  const ps = HEADER +
    "  100     1 /bin/zsh\n" +
    "  200   100 node server.js\n";

  const results = parsePsOutput(ps, [100]);
  assert.equal(results.length, 0);
});

test("getProcessListCommand uses PowerShell on Windows", () => {
  assert.deepEqual(getProcessListCommand("win32"), {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
  });
});

test("splitCommandLine keeps quoted wrapper command aligned with remaining args", () => {
  assert.deepEqual(
    splitCommandLine("\"C:\\Program Files\\nodejs\\node.exe\" C:\\Users\\foo\\AppData\\Roaming\\npm\\claude"),
    {
      command: "C:\\Program Files\\nodejs\\node.exe",
      rest: "C:\\Users\\foo\\AppData\\Roaming\\npm\\claude",
    },
  );
});

test("parseWindowsProcessListOutput detects node.exe wrapper paths", () => {
  const processes = JSON.stringify([
    { ProcessId: 100, ParentProcessId: 1, CommandLine: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" },
    {
      ProcessId: 200,
      ParentProcessId: 100,
      CommandLine: "\"C:\\Program Files\\nodejs\\node.exe\" C:\\Users\\foo\\AppData\\Roaming\\npm\\claude",
    },
  ]);

  const results = parseWindowsProcessListOutput(processes, [100]);
  assert.equal(results.length, 1);
  assert.equal(results[0].cliType, "claude");
});

test("parseWindowsProcessListOutput handles single-object JSON output", () => {
  const processJson = JSON.stringify({
    ProcessId: 200,
    ParentProcessId: 100,
    CommandLine: "C:\\Users\\foo\\bin\\codex.exe --help",
  });

  const results = parseWindowsProcessListOutput(processJson, [100]);
  assert.equal(results.length, 1);
  assert.equal(results[0].cliType, "codex");
});
