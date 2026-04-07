import test from "node:test";
import assert from "node:assert/strict";
import {
  isProcessAlive,
  waitForDeath,
  killProcessEscalated,
} from "../shared/processKill.ts";

test("isProcessAlive returns false for PID that does not exist", () => {
  // PID 99999999 almost certainly doesn't exist
  assert.equal(isProcessAlive(99999999), false);
});

test("isProcessAlive returns true for current process", () => {
  assert.equal(isProcessAlive(process.pid), true);
});

test("waitForDeath returns true immediately for dead PID", async () => {
  const result = await waitForDeath(99999999, 1000, 50);
  assert.equal(result, true);
});

test("waitForDeath returns false for live PID with short timeout", async () => {
  const result = await waitForDeath(process.pid, 50, 25);
  assert.equal(result, false);
});

test("killProcessEscalated returns already_dead for nonexistent PID", async () => {
  const result = await killProcessEscalated(99999999);
  assert.equal(result.method, "already_dead");
  assert.ok(result.elapsedMs < 100, `Expected <100ms, got ${result.elapsedMs}ms`);
});

test("killProcessEscalated refuses to kill PID <= 1", async () => {
  const result = await killProcessEscalated(1);
  assert.equal(result.method, "already_dead");
  assert.equal(result.elapsedMs, 0);
});

test("killProcessEscalated kills a child process", async () => {
  // processGroup: false because Windows doesn't support negative PID kills.
  const { spawn } = await import("node:child_process");
  const child = spawn("node", ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  const pid = child.pid!;
  assert.equal(isProcessAlive(pid), true);

  const result = await killProcessEscalated(pid, {
    signal: "SIGTERM",
    termMs: 3000,
    killMs: 1000,
    processGroup: false,
  });

  assert.ok(
    result.method === "graceful" || result.method === "force_killed",
    `Expected graceful or force_killed, got ${result.method}`,
  );
  assert.equal(isProcessAlive(pid), false);
});
