import test from "node:test";
import assert from "node:assert/strict";

import { createAppCloseCleanup } from "../electron/app-lifecycle.ts";

test("createAppCloseCleanup runs cleanup once in the expected order", async () => {
  const calls: string[] = [];
  const cleanup = createAppCloseCleanup({
    outputBatcher: { dispose: () => calls.push("output") },
    ptyManager: { destroyAll: async () => calls.push("pty") },
    gitWatcher: { unwatchAll: () => calls.push("git") },
    fileTreeWatcher: { unwatchAll: () => calls.push("fs") },
    sessionWatcher: { unwatchAll: () => calls.push("session") },
    telemetryService: { dispose: () => calls.push("telemetry") },
    agentService: { dispose: async () => calls.push("agent") },
  });

  await cleanup();
  await cleanup();

  assert.deepEqual(calls, [
    "output",
    "pty",
    "git",
    "fs",
    "session",
    "telemetry",
    "agent",
  ]);
});
