import test from "node:test";
import assert from "node:assert/strict";

import { PtyManager } from "../electron/pty-manager.ts";

test("notifyThemeChanged sends SIGWINCH to the PTY child on unix platforms", () => {
  const manager = new PtyManager() as PtyManager & {
    instances: Map<number, { pid?: number }>;
  };
  manager.instances.set(7, { pid: 4321 });

  const originalKill = process.kill;
  const calls: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  (process as typeof process & {
    kill: (pid: number, signal: NodeJS.Signals) => boolean;
  }).kill = ((pid: number, signal: NodeJS.Signals) => {
    calls.push({ pid, signal });
    return true;
  }) as typeof process.kill;

  try {
    manager.notifyThemeChanged(7);
  } finally {
    process.kill = originalKill;
  }

  assert.deepEqual(calls, [{ pid: 4321, signal: "SIGWINCH" }]);
});

test("notifyThemeChanged ignores unknown PTYs", () => {
  const manager = new PtyManager();
  manager.notifyThemeChanged(999);
  assert.ok(true);
});

test("destroyOwnedBy destroys every PTY registered to a renderer owner", async () => {
  const manager = new PtyManager() as PtyManager & {
    owners: Map<number, number>;
    destroy: (id: number) => Promise<void>;
  };
  manager.owners.set(7, 101);
  manager.owners.set(8, 101);
  manager.owners.set(9, 202);

  const destroyed: number[] = [];
  manager.destroy = async (id: number) => {
    destroyed.push(id);
    manager.owners.delete(id);
  };

  await manager.destroyOwnedBy(101);

  assert.deepEqual(destroyed, [7, 8]);
  assert.deepEqual([...manager.owners.entries()], [[9, 202]]);
});
