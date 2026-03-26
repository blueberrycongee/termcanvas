import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonOrDie,
  buildTermcanvasArgs,
  buildTerminalCreateArgs,
  buildTerminalInputArgs,
  buildTelemetryEventsArgs,
  buildTelemetryTerminalArgs,
  buildTelemetryWorkflowArgs,
  getTermCanvasPortFile,
  isTermCanvasRunning,
} from "../src/termcanvas.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("parseJsonOrDie parses valid JSON", () => {
  const result = parseJsonOrDie('{"id":"abc","status":"running"}');
  assert.deepStrictEqual(result, { id: "abc", status: "running" });
});

test("parseJsonOrDie throws on invalid JSON", () => {
  assert.throws(
    () => parseJsonOrDie("not json"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Failed to parse/);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "TERMCANVAS_INVALID_JSON");
      assert.equal((error as Error & { stage?: string }).stage, "termcanvas.parse_json");
      assert.deepStrictEqual((error as Error & { ids?: Record<string, string> }).ids, {});
      return true;
    },
  );
});

test("buildTermcanvasArgs builds correct args", () => {
  const args = buildTermcanvasArgs("terminal", "status", ["tc-001"]);
  assert.deepStrictEqual(args, ["terminal", "status", "tc-001", "--json"]);
});

test("buildTerminalCreateArgs preserves spaces in worktree path as one argv entry", () => {
  const args = buildTerminalCreateArgs("/tmp/dir with space", "codex");
  assert.deepStrictEqual(args, [
    "terminal",
    "create",
    "--worktree",
    "/tmp/dir with space",
    "--type",
    "codex",
    "--json",
  ]);
});

test("buildTerminalCreateArgs includes prompt when provided", () => {
  const args = buildTerminalCreateArgs("/tmp/wt", "claude", "Do the task");
  assert.deepStrictEqual(args, [
    "terminal",
    "create",
    "--worktree",
    "/tmp/wt",
    "--type",
    "claude",
    "--prompt",
    "Do the task",
    "--json",
  ]);
});

test("buildTerminalCreateArgs includes workflow telemetry metadata when provided", () => {
  const args = buildTerminalCreateArgs(
    "/tmp/wt",
    "codex",
    "Do the task",
    true,
    "parent-1",
    "workflow-1",
    "handoff-1",
    "/repo/project",
  );
  assert.deepStrictEqual(args, [
    "terminal",
    "create",
    "--worktree",
    "/tmp/wt",
    "--type",
    "codex",
    "--prompt",
    "Do the task",
    "--auto-approve",
    "--parent-terminal",
    "parent-1",
    "--workflow-id",
    "workflow-1",
    "--handoff-id",
    "handoff-1",
    "--repo",
    "/repo/project",
    "--json",
  ]);
});

test("buildTerminalInputArgs preserves shell metacharacters as literal text", () => {
  const args = buildTerminalInputArgs("tc-001", 'do $(touch /tmp/pwned) `uname`');
  assert.deepStrictEqual(args, [
    "terminal",
    "input",
    "tc-001",
    'do $(touch /tmp/pwned) `uname`',
    "--json",
  ]);
});

test("buildTelemetryTerminalArgs targets telemetry terminal get", () => {
  assert.deepStrictEqual(
    buildTelemetryTerminalArgs("tc-001"),
    ["telemetry", "get", "--terminal", "tc-001", "--json"],
  );
});

test("buildTelemetryWorkflowArgs targets workflow get with repo", () => {
  assert.deepStrictEqual(
    buildTelemetryWorkflowArgs("workflow-1", "/repo/project"),
    ["telemetry", "get", "--workflow", "workflow-1", "--repo", "/repo/project", "--json"],
  );
});

test("buildTelemetryEventsArgs includes optional cursor", () => {
  assert.deepStrictEqual(
    buildTelemetryEventsArgs("tc-001", 20, "tc-001:5"),
    ["telemetry", "events", "--terminal", "tc-001", "--limit", "20", "--cursor", "tc-001:5", "--json"],
  );
});

test("getTermCanvasPortFile respects TERMCANVAS_INSTANCE and TERMCANVAS_PORT_FILE", () => {
  assert.equal(
    getTermCanvasPortFile({ TERMCANVAS_INSTANCE: "dev" }),
    path.join(os.homedir(), ".termcanvas-dev", "port"),
  );
  assert.equal(
    getTermCanvasPortFile({ TERMCANVAS_PORT_FILE: "/tmp/termcanvas-port" }),
    "/tmp/termcanvas-port",
  );
});

test("isTermCanvasRunning can target an explicit port file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-port-file-"));
  const portFile = path.join(dir, "port");
  fs.writeFileSync(portFile, "12345", "utf-8");

  try {
    assert.equal(
      isTermCanvasRunning({ TERMCANVAS_PORT_FILE: portFile }),
      true,
    );
    assert.equal(
      isTermCanvasRunning({
        TERMCANVAS_PORT_FILE: path.join(dir, "missing-port"),
      }),
      false,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
