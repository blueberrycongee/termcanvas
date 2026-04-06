import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function withStateModule<T>(
  fn: (mod: typeof import("../electron/state-persistence.ts"), stateFile: string) => Promise<T> | T,
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-state-test-"));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  delete process.env.VITE_DEV_SERVER_URL;
  const mod = await import(`../electron/state-persistence.ts?${Date.now()}`);
  const stateFile = path.join(mod.TERMCANVAS_DIR, "state.json");

  try {
    return await fn(mod, stateFile);
  } finally {
    if (prevHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = prevHome;
    }
    if (prevUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = prevUserProfile;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("StatePersistence saves versioned envelopes and loads the payload", async () => {
  await withStateModule(async ({ StatePersistence }, stateFile) => {
    const persistence = new StatePersistence();
    persistence.save({ hello: "world" });

    const raw = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    assert.equal(raw.version, 1);
    assert.deepEqual(raw.payload, { hello: "world" });
    assert.deepEqual(persistence.load(), { hello: "world" });
  });
});

test("StatePersistence still loads legacy raw snapshots", async () => {
  await withStateModule(async ({ StatePersistence }, stateFile) => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ legacy: true }), "utf-8");

    const persistence = new StatePersistence();
    assert.deepEqual(persistence.load(), { legacy: true });
  });
});
