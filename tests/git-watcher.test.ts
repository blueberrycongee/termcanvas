import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import { GitFileWatcher } from "../electron/git-watcher.ts";

function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Timed out waiting for watcher callback"));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

test("GitFileWatcher detects repository presence and separates diff vs log refresh signals", async () => {
  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "git-watcher-test-"));
  const watcher = new GitFileWatcher();
  const presenceEvents: boolean[] = [];
  let diffEvents = 0;
  let logEvents = 0;

  try {
    watcher.watch(worktreePath, {
      onChanged: () => {
        diffEvents += 1;
      },
      onLogChanged: () => {
        logEvents += 1;
      },
      onPresenceChanged: (isRepo) => {
        presenceEvents.push(isRepo);
      },
    });

    execSync("git init -b main", {
      cwd: worktreePath,
      stdio: "pipe",
    });
    execSync('git config user.name "Test User"', {
      cwd: worktreePath,
      stdio: "pipe",
    });
    execSync('git config user.email "test@example.com"', {
      cwd: worktreePath,
      stdio: "pipe",
    });
    await waitFor(() => presenceEvents.includes(true));

    const gitDir = path.join(worktreePath, ".git");
    fs.writeFileSync(path.join(gitDir, "COMMIT_EDITMSG"), "new message\n");
    await waitFor(() => logEvents > 0);

    fs.writeFileSync(path.join(worktreePath, "tracked.txt"), "tracked\n");
    execSync("git add tracked.txt", {
      cwd: worktreePath,
      stdio: "pipe",
    });
    await waitFor(() => diffEvents > 0);

    fs.rmSync(gitDir, { recursive: true, force: true });
    await waitFor(() => presenceEvents.includes(false));
  } finally {
    watcher.unwatch(worktreePath);
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }

  assert.equal(presenceEvents[0], true);
  assert.equal(logEvents > 0, true);
  assert.equal(diffEvents > 0, true);
  assert.equal(presenceEvents.includes(false), true);
});
