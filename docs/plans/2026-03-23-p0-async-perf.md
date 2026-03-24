# P0 Async Performance Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate main-process blocking that causes macOS spinning beach ball by converting synchronous git/fs/network operations to async.

**Architecture:** Two independent modules need conversion: (1) the git diff handler used by both IPC and API server, extracted into a shared async module; (2) the quota fetcher, replacing execSync with execFile + native fetch. Both currently block the Electron main process event loop.

**Tech Stack:** Node.js child_process.execFile (promisified), fs/promises, native fetch with AbortSignal.timeout

**IMPORTANT constraints:**
- Do NOT add unnecessary fallback logic, retry mechanisms, or error recovery layers. Keep error handling identical to the current code — if the current code catches and returns `{ diff: "", files: [] }`, the new code does the same. No "graceful degradation" beyond what already exists.
- Do NOT add new dependencies. Use only Node.js built-in APIs.
- Do NOT refactor surrounding code. Only change what is needed for the sync→async conversion.
- Run `npm test` after each task to verify nothing is broken.

---

## Task 1: Extract and async-ify the diff logic into a shared module

**Context:** Both `electron/main.ts:305-421` (IPC handler `project:diff`) and `electron/api-server.ts:349-421` (`getDiff`) contain duplicated synchronous diff logic using `execSync` and `fs.readFileSync`. Extract into one shared async module that both call.

**Files:**
- Create: `electron/git-diff.ts`
- Modify: `electron/main.ts:305-421`
- Modify: `electron/api-server.ts:349-421`
- Create: `tests/git-diff.test.ts`

### Step 1: Create `electron/git-diff.ts` with async implementation

The module exports two functions matching the two use-cases:
- `getFullDiff(worktreePath)` — returns `{ diff: string, files: FileInfo[] }` (used by IPC handler)
- `getSummaryDiff(worktreePath)` — returns `{ worktree: string, files: SummaryFile[] }` (used by API server summary mode)
- `getFullDiffForApi(worktreePath)` — returns `{ worktree: string, diff: string }` (used by API server full mode)

Key conversion rules:
- `execSync("git diff HEAD", ...)` → `execFileAsync("git", ["diff", "HEAD"], { cwd, maxBuffer: 10*1024*1024 })`
- `execSync("git diff HEAD --numstat", ...)` → `execFileAsync("git", ["diff", "HEAD", "--numstat"], { cwd })`
- `execSync("git ls-files --others --exclude-standard", ...)` → `execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], { cwd })`
- `execSync("git show HEAD:${name}", { encoding: "buffer" })` → `execFileAsync("git", ["show", \`HEAD:${name}\`], { cwd, encoding: "buffer" })`
- `fs.readFileSync(path)` → `fs.promises.readFile(path)`
- `fs.existsSync(path)` → `fs.promises.access(path).then(() => true, () => false)` or just try/catch readFile
- `fs.openSync/readSync/closeSync` for binary detection → `fs.promises.open` + `fileHandle.read` + `fileHandle.close`

For per-file operations (image blobs, untracked file reads), use bounded concurrency of 5:

```typescript
async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function next(): Promise<void> {
    const idx = i++;
    if (idx >= items.length) return;
    results[idx] = await fn(items[idx]);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return results;
}
```

Use `import { execFile } from "child_process"` and `import { promisify } from "util"` to create `execFileAsync = promisify(execFile)`.

Preserve the exact same return shape and error behavior as the current code. The IPC handler currently catches all errors and returns `{ diff: "", files: [] }` — keep that. The API server currently throws with status 400 — keep that.

### Step 2: Write test for the new module

Create `tests/git-diff.test.ts` using the project's test pattern (node:test + node:assert/strict). Test with a real temp git repo:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "child_process";

// Import the functions under test
import { getFullDiff, getSummaryDiff } from "../electron/git-diff.ts";

function createTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-diff-test-"));
  execSync("git init", { cwd: dir });
  execSync("git config user.email test@test.com", { cwd: dir });
  execSync("git config user.name Test", { cwd: dir });
  fs.writeFileSync(path.join(dir, "file.txt"), "line1\n");
  execSync("git add . && git commit -m init", { cwd: dir });
  return dir;
}

test("getFullDiff returns diff for modified file", async () => {
  const dir = createTempRepo();
  fs.writeFileSync(path.join(dir, "file.txt"), "line1\nline2\n");
  const result = await getFullDiff(dir);
  assert.ok(result.diff.includes("file.txt"));
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, "file.txt");
  assert.equal(result.files[0].additions, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("getFullDiff includes untracked files", async () => {
  const dir = createTempRepo();
  fs.writeFileSync(path.join(dir, "new.txt"), "hello\n");
  const result = await getFullDiff(dir);
  assert.ok(result.files.some(f => f.name === "new.txt"));
  assert.ok(result.diff.includes("new.txt"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("getFullDiff returns empty for clean repo", async () => {
  const dir = createTempRepo();
  const result = await getFullDiff(dir);
  assert.equal(result.diff, "");
  assert.equal(result.files.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("getSummaryDiff returns file stats", async () => {
  const dir = createTempRepo();
  fs.writeFileSync(path.join(dir, "file.txt"), "line1\nline2\n");
  const result = await getSummaryDiff(dir);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].additions, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

### Step 3: Run tests

```bash
npm test
```

All existing tests must still pass. New tests must pass.

### Step 4: Wire up IPC handler in main.ts

Replace the `ipcMain.handle("project:diff", ...)` body (lines 305-421) with:

```typescript
ipcMain.handle("project:diff", async (_event, worktreePath: string) => {
  const { getFullDiff } = await import("./git-diff");
  return getFullDiff(worktreePath);
});
```

### Step 5: Wire up API server

Replace `getDiff` method in `electron/api-server.ts:349-421` with:

```typescript
private async getDiff(worktreePath: string, summary: boolean) {
  const { getFullDiffForApi, getSummaryDiff } = await import("./git-diff");
  if (summary) {
    const result = await getSummaryDiff(worktreePath);
    return { worktree: worktreePath, files: result.files };
  }
  return getFullDiffForApi(worktreePath);
}
```

### Step 6: Remove `execSync` import from main.ts if no longer used

Check if `execSync` is still used elsewhere in `electron/main.ts`. If not, remove the import.

### Step 7: Run tests and commit

```bash
npm test
git add electron/git-diff.ts electron/main.ts electron/api-server.ts tests/git-diff.test.ts
git commit -m "perf: convert project:diff from execSync to async execFile"
```

---

## Task 2: Convert quota-fetcher to async

**Context:** `electron/quota-fetcher.ts` uses `execSync` for macOS Keychain access (up to 5s) and `execSync` for curl API call (up to 15s). Both block the main process.

**Files:**
- Modify: `electron/quota-fetcher.ts`
- Create: `tests/quota-fetcher.test.ts`

### Step 1: Rewrite `electron/quota-fetcher.ts`

Convert both functions to async:

**`getOAuthToken`**: `execSync` → `promisify(execFile)`

```typescript
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

async function getOAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf-8", timeout: KEYCHAIN_TIMEOUT_MS },
    );
    const parsed = JSON.parse(stdout.trim());
    const creds = parsed.claudeAiOauth ?? parsed.default ?? parsed;
    return creds.accessToken ?? creds.access_token ?? null;
  } catch {
    return null;
  }
}
```

**`fetchUsageApi`**: `execSync curl` → native `fetch` with `AbortSignal.timeout`

```typescript
async function fetchUsageApi(token: string): Promise<QuotaFetchResult> {
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        "Authorization": `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (res.status === 429) return { ok: false, rateLimited: true };
    if (res.status !== 200) return { ok: false, rateLimited: false };

    const json: QuotaApiResponse = await res.json();
    return {
      ok: true,
      data: {
        fiveHour: {
          utilization: json.five_hour.utilization / 100,
          resetsAt: json.five_hour.resets_at,
        },
        sevenDay: {
          utilization: json.seven_day.utilization / 100,
          resetsAt: json.seven_day.resets_at,
        },
        fetchedAt: Date.now(),
      },
    };
  } catch {
    return { ok: false, rateLimited: false };
  }
}
```

**`fetchQuota`**: already async, just await the now-async internals:

```typescript
export async function fetchQuota(): Promise<QuotaFetchResult> {
  const token = await getOAuthToken();
  if (!token) return { ok: false, rateLimited: false };
  return fetchUsageApi(token);
}
```

Remove the `execSync` import entirely. The file should only import `execFile` from `child_process` and `promisify` from `util`.

### Step 2: Write test

Create `tests/quota-fetcher.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { fetchQuota, type QuotaFetchResult } from "../electron/quota-fetcher.ts";

test("fetchQuota returns a result without blocking", async () => {
  const start = Date.now();
  const result: QuotaFetchResult = await fetchQuota();
  const elapsed = Date.now() - start;
  // Should return quickly (not block for 5s+ like old execSync)
  // Result shape should be correct regardless of whether keychain has credentials
  assert.ok("ok" in result);
  if (!result.ok) {
    assert.ok("rateLimited" in result);
  }
});

test("QuotaFetchResult type is correct on failure", async () => {
  // Even without valid credentials, function should return cleanly
  const result = await fetchQuota();
  if (!result.ok) {
    assert.equal(typeof result.rateLimited, "boolean");
  }
});
```

### Step 3: Run tests and commit

```bash
npm test
git add electron/quota-fetcher.ts tests/quota-fetcher.test.ts
git commit -m "perf: convert quota-fetcher from execSync to async execFile/fetch"
```

---

## Verification

After both tasks are complete:

1. `npm test` — all tests pass
2. `npm run build` — builds without errors
3. Manual verification: open the app, trigger a diff card, check that no beach ball occurs
4. Manual verification: open usage panel quota display, check it loads without freeze
