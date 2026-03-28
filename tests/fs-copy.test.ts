import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fs-copy-test-"));
}

test("copyFiles copies a single file to destDir", async () => {
  const { copyFiles } = await import("../electron/fs-copy.ts");
  const src = makeTmpDir();
  const dest = makeTmpDir();
  fs.writeFileSync(path.join(src, "a.txt"), "hello");

  const result = await copyFiles([path.join(src, "a.txt")], dest);
  assert.deepEqual(result.copied, ["a.txt"]);
  assert.deepEqual(result.skipped, []);
  assert.equal(fs.readFileSync(path.join(dest, "a.txt"), "utf8"), "hello");

  fs.rmSync(src, { recursive: true });
  fs.rmSync(dest, { recursive: true });
});

test("copyFiles copies a directory recursively", async () => {
  const { copyFiles } = await import("../electron/fs-copy.ts");
  const src = makeTmpDir();
  const dest = makeTmpDir();
  const sub = path.join(src, "sub");
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, "b.txt"), "world");

  const result = await copyFiles([sub], dest);
  assert.deepEqual(result.copied, ["sub"]);
  assert.equal(fs.readFileSync(path.join(dest, "sub", "b.txt"), "utf8"), "world");

  fs.rmSync(src, { recursive: true });
  fs.rmSync(dest, { recursive: true });
});

test("copyFiles skips existing names", async () => {
  const { copyFiles } = await import("../electron/fs-copy.ts");
  const src = makeTmpDir();
  const dest = makeTmpDir();
  fs.writeFileSync(path.join(src, "c.txt"), "new");
  fs.writeFileSync(path.join(dest, "c.txt"), "old");

  const result = await copyFiles([path.join(src, "c.txt")], dest);
  assert.deepEqual(result.copied, []);
  assert.deepEqual(result.skipped, ["c.txt"]);
  assert.equal(fs.readFileSync(path.join(dest, "c.txt"), "utf8"), "old");

  fs.rmSync(src, { recursive: true });
  fs.rmSync(dest, { recursive: true });
});

test("copyFiles handles multiple files", async () => {
  const { copyFiles } = await import("../electron/fs-copy.ts");
  const src = makeTmpDir();
  const dest = makeTmpDir();
  fs.writeFileSync(path.join(src, "x.txt"), "x");
  fs.writeFileSync(path.join(src, "y.txt"), "y");

  const result = await copyFiles([
    path.join(src, "x.txt"),
    path.join(src, "y.txt"),
  ], dest);
  assert.deepEqual(result.copied.sort(), ["x.txt", "y.txt"]);
  assert.deepEqual(result.skipped, []);

  fs.rmSync(src, { recursive: true });
  fs.rmSync(dest, { recursive: true });
});
