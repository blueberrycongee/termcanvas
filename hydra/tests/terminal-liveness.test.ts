import test from "node:test";
import assert from "node:assert/strict";
import { checkTerminalAlive } from "../src/terminal-liveness.ts";

test("checkTerminalAlive returns true when telemetry reports pty_alive=true", () => {
  const result = checkTerminalAlive("terminal-abc", {
    isTermCanvasRunning: () => true,
    telemetryTerminal: () => ({ pty_alive: true }),
  });
  assert.equal(result, true);
});

test("checkTerminalAlive returns false when telemetry reports pty_alive=false", () => {
  const result = checkTerminalAlive("terminal-abc", {
    isTermCanvasRunning: () => true,
    telemetryTerminal: () => ({ pty_alive: false }),
  });
  assert.equal(result, false);
});

test("checkTerminalAlive returns null when TermCanvas is not running", () => {
  // Without TermCanvas there is no authoritative source of PTY state. The
  // watch loop must keep polling rather than assume the PTY is dead — an
  // app restart should not cascade into a spurious timeout of the live
  // worker that survived it.
  let probed = false;
  const result = checkTerminalAlive("terminal-abc", {
    isTermCanvasRunning: () => false,
    telemetryTerminal: () => {
      probed = true;
      return { pty_alive: true };
    },
  });
  assert.equal(result, null);
  assert.equal(probed, false, "must not probe telemetry when TermCanvas is down");
});

test("checkTerminalAlive returns null when telemetry snapshot is unavailable", () => {
  const result = checkTerminalAlive("terminal-abc", {
    isTermCanvasRunning: () => true,
    telemetryTerminal: () => null,
  });
  assert.equal(result, null);
});

test("checkTerminalAlive returns null when pty_alive field is missing", () => {
  // Future telemetry payloads may omit pty_alive (trimmed snapshots, schema
  // drift). Absence is not presence of death — return null so the watch
  // loop keeps polling instead of timing out the assignment.
  const result = checkTerminalAlive("terminal-abc", {
    isTermCanvasRunning: () => true,
    telemetryTerminal: () => ({}),
  });
  assert.equal(result, null);
});

test("checkTerminalAlive returns null when telemetry throws", () => {
  const result = checkTerminalAlive("terminal-abc", {
    isTermCanvasRunning: () => true,
    telemetryTerminal: () => {
      throw new Error("telemetry unreachable");
    },
  });
  assert.equal(result, null);
});
