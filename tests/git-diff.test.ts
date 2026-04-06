import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import {
  getApiDiff,
  getProjectDiff,
} from "../electron/git-diff.ts";

function removeDirWithRetry(dir: string): void {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "ENOTEMPTY") {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

async function withTempRepo(fn: (repoPath: string) => Promise<void> | void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-diff-test-"));
  try {
    execSync("git init", {
      cwd: dir,
      stdio: "pipe",
    });
    execSync('git config user.name "Test User"', {
      cwd: dir,
      stdio: "pipe",
    });
    execSync('git config user.email "test@example.com"', {
      cwd: dir,
      stdio: "pipe",
    });
    await fn(dir);
  } finally {
    removeDirWithRetry(dir);
  }
}

test("getProjectDiff preserves tracked, untracked, and image metadata", async () => {
  await withTempRepo(async (repoPath) => {
    const trackedTextPath = path.join(repoPath, "tracked.txt");
    const trackedImagePath = path.join(repoPath, "tracked.png");
    const untrackedTextPath = path.join(repoPath, "notes.txt");
    const untrackedImagePath = path.join(repoPath, "new-image.png");

    const trackedImageOld = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    const trackedImageNew = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
    ]);
    const untrackedImage = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02,
    ]);

    fs.writeFileSync(trackedTextPath, "before\n");
    fs.writeFileSync(trackedImagePath, trackedImageOld);
    execSync('git add tracked.txt tracked.png && git commit -m "init"', {
      cwd: repoPath,
      stdio: "pipe",
    });

    fs.writeFileSync(trackedTextPath, "before\nafter\n");
    fs.writeFileSync(trackedImagePath, trackedImageNew);
    fs.writeFileSync(untrackedTextPath, "alpha\nbeta\n");
    fs.writeFileSync(untrackedImagePath, untrackedImage);

    const result = await getProjectDiff(repoPath);

    assert.match(result.diff, /diff --git a\/tracked\.txt b\/tracked\.txt/);
    assert.match(result.diff, /diff --git a\/notes\.txt b\/notes\.txt/);
    assert.match(result.diff, /diff --git a\/new-image\.png b\/new-image\.png\nnew file\nBinary file\n/);

    assert.deepEqual(
      result.files.map((file) => file.name),
      ["tracked.png", "tracked.txt", "new-image.png", "notes.txt"],
    );

    const trackedImageFile = result.files.find((file) => file.name === "tracked.png");
    assert.deepEqual(trackedImageFile, {
      name: "tracked.png",
      additions: 0,
      deletions: 0,
      binary: true,
      isImage: true,
      imageOld: `data:image/png;base64,${trackedImageOld.toString("base64")}`,
      imageNew: `data:image/png;base64,${trackedImageNew.toString("base64")}`,
    });

    const trackedTextFile = result.files.find((file) => file.name === "tracked.txt");
    assert.deepEqual(trackedTextFile, {
      name: "tracked.txt",
      additions: 1,
      deletions: 0,
      binary: false,
      isImage: false,
      imageOld: null,
      imageNew: null,
    });

    const untrackedImageFile = result.files.find((file) => file.name === "new-image.png");
    assert.deepEqual(untrackedImageFile, {
      name: "new-image.png",
      additions: 0,
      deletions: 0,
      binary: true,
      isImage: true,
      imageOld: null,
      imageNew: `data:image/png;base64,${untrackedImage.toString("base64")}`,
    });

    const untrackedTextFile = result.files.find((file) => file.name === "notes.txt");
    assert.deepEqual(untrackedTextFile, {
      name: "notes.txt",
      additions: 2,
      deletions: 0,
      binary: false,
      isImage: false,
      imageOld: null,
      imageNew: null,
    });
  });
});

test("getApiDiff preserves existing summary shape", async () => {
  await withTempRepo(async (repoPath) => {
    const trackedPath = path.join(repoPath, "tracked.txt");
    const trackedBinaryPath = path.join(repoPath, "tracked.png");
    const untrackedPath = path.join(repoPath, "notes.txt");
    const trackedBinaryOld = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    const trackedBinaryNew = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
    ]);

    fs.writeFileSync(trackedPath, "before\n");
    fs.writeFileSync(trackedBinaryPath, trackedBinaryOld);
    execSync('git add tracked.txt tracked.png && git commit -m "init"', {
      cwd: repoPath,
      stdio: "pipe",
    });

    fs.writeFileSync(trackedPath, "before\nafter\n");
    fs.writeFileSync(trackedBinaryPath, trackedBinaryNew);
    fs.writeFileSync(untrackedPath, "alpha\nbeta\n");

    const result = await getApiDiff(repoPath, true);

    assert.equal(result.worktree, repoPath);
    assert.deepEqual(result.files, [
      {
        name: "tracked.png",
        additions: 0,
        deletions: 0,
        binary: true,
      },
      {
        name: "tracked.txt",
        additions: 1,
        deletions: 0,
        binary: false,
      },
      {
        name: "notes.txt",
        additions: 2,
        deletions: 0,
        binary: false,
      },
    ]);
  });
});

test("getApiDiff preserves existing full diff shape", async () => {
  await withTempRepo(async (repoPath) => {
    const trackedPath = path.join(repoPath, "tracked.txt");
    const untrackedPath = path.join(repoPath, "notes.txt");

    fs.writeFileSync(trackedPath, "before\n");
    execSync('git add tracked.txt && git commit -m "init"', {
      cwd: repoPath,
      stdio: "pipe",
    });

    fs.writeFileSync(trackedPath, "before\nafter\n");
    fs.writeFileSync(untrackedPath, "alpha\nbeta\n");

    const result = await getApiDiff(repoPath, false);

    assert.deepEqual(result.worktree, repoPath);
    assert.match(result.diff, /diff --git a\/tracked\.txt b\/tracked\.txt/);
    assert.match(result.diff, /diff --git a\/notes\.txt b\/notes\.txt/);
    assert.doesNotMatch(result.diff, /Binary file/);
  });
});

test("getProjectDiff returns a truncation notice instead of failing on oversized diffs", async () => {
  await withTempRepo(async (repoPath) => {
    const largePath = path.join(repoPath, "large.txt");
    fs.writeFileSync(largePath, "start\n");
    execSync('git add large.txt && git commit -m "init"', {
      cwd: repoPath,
      stdio: "pipe",
    });

    fs.writeFileSync(largePath, `${"x".repeat(1024)}\n`.repeat(12_000));

    const result = await getProjectDiff(repoPath);
    assert.match(result.diff, /\[termcanvas\] diff truncated because it exceeded 10 MiB\./);
  });
});

test("getProjectDiff skips large image previews to avoid loading them into memory", async () => {
  await withTempRepo(async (repoPath) => {
    const trackedImagePath = path.join(repoPath, "tracked.png");
    const tinyPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);

    fs.writeFileSync(trackedImagePath, tinyPng);
    execSync('git add tracked.png && git commit -m "init"', {
      cwd: repoPath,
      stdio: "pipe",
    });

    fs.writeFileSync(trackedImagePath, Buffer.alloc(6 * 1024 * 1024, 1));

    const result = await getProjectDiff(repoPath);
    const file = result.files.find((entry) => entry.name === "tracked.png");
    assert.ok(file);
    assert.equal(file.imageOld, `data:image/png;base64,${tinyPng.toString("base64")}`);
    assert.equal(file.imageNew, null);
  });
});
