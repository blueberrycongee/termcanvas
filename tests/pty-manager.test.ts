import test from "node:test";
import assert from "node:assert/strict";

test(
  "notifyThemeChanged sends SIGWINCH to the PTY child on unix platforms",
  { skip: process.platform === "win32" },
  async () => {
    const { PtyManager } = await import(
      `../electron/pty-manager.ts?sigwinch=${Date.now()}`,
    );
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
  },
);

test("notifyThemeChanged ignores unknown PTYs", async () => {
  const { PtyManager } = await import(
    `../electron/pty-manager.ts?unknown=${Date.now()}`,
  );
  const manager = new PtyManager();
  manager.notifyThemeChanged(999);
  assert.ok(true);
});

test(
  "create retries transient PTY spawn failures before surfacing an error",
  { skip: process.platform === "win32" },
  async () => {
    let attempts = 0;
    const { PtyManager } = await import(
      `../electron/pty-manager.ts?retry=${Date.now()}`,
    );
    const manager = new PtyManager({
      buildLaunchSpec: async () => ({
        cwd: process.cwd(),
        file: "/bin/sh",
        args: [],
        env: {},
      }),
      spawn: ((..._args: unknown[]) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("posix_spawnp failed.");
        }
        return { pid: 9876 };
      }) as typeof import("node-pty").spawn,
    });
    const id = await manager.create({
      cwd: process.cwd(),
    });

    assert.equal(id, 1);
    assert.equal(manager.getPid(id), 9876);
    assert.equal(attempts, 2);
  },
);
