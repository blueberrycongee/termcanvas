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
    fs.rmSync(dir, { recursive: true, force: true });
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
