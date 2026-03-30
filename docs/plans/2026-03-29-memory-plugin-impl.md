# Memory Enhancement Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a SessionStart hook that injects an enhanced memory index (explicit cross-references + time-sensitive warnings) into Claude Code / Codex sessions.

**Architecture:** A new `memory-index-generator.ts` module generates a `<memory-graph>` text block from memory files by extracting markdown links between files and dates > 14 days old. The API server exposes `GET /api/memory/index?worktree=...` to serve this text. A shell script hook fetches it at session start and returns it as `additionalContext`. The existing `watchMemoryDir` callback in `main.ts` is extended to regenerate the index on file changes.

**Tech Stack:** TypeScript (Node), shell script, Claude Code hooks API

**Design doc:** `docs/plans/2026-03-29-memory-plugin-design-zh.md`

---

## Task 1: Core index generator — `findExplicitReferences`

**Files:**
- Create: `electron/memory-index-generator.ts`
- Create: `tests/memory-index-generator.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/memory-index-generator.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

test("findExplicitReferences extracts cross-file markdown links", async () => {
  const { findExplicitReferences } = await import(
    `../electron/memory-index-generator.ts?refs-${Date.now()}`
  );

  const nodes = [
    {
      fileName: "MEMORY.md",
      type: "index",
      body: "- [Auth](project_auth.md) — rewrite\n- [DB](feedback_db.md) — tests",
    },
    {
      fileName: "project_auth.md",
      type: "project",
      body: "Auth rewrite driven by compliance.\nSee also [DB test policy](feedback_db.md) for related constraints.",
    },
    {
      fileName: "feedback_db.md",
      type: "feedback",
      body: "Integration tests must hit real DB.",
    },
  ];

  const refs = findExplicitReferences(nodes);

  // MEMORY.md links are excluded (already in index)
  // project_auth.md -> feedback_db.md should be found
  assert.equal(refs.length, 1);
  assert.equal(refs[0].from, "project_auth.md");
  assert.equal(refs[0].to, "feedback_db.md");
});

test("findExplicitReferences ignores links to non-existent files", async () => {
  const { findExplicitReferences } = await import(
    `../electron/memory-index-generator.ts?nofile-${Date.now()}`
  );

  const nodes = [
    {
      fileName: "project_auth.md",
      type: "project",
      body: "See [external](not-in-memory.md) for details.",
    },
  ];

  const refs = findExplicitReferences(nodes);
  assert.equal(refs.length, 0);
});

test("findExplicitReferences ignores self-links", async () => {
  const { findExplicitReferences } = await import(
    `../electron/memory-index-generator.ts?self-${Date.now()}`
  );

  const nodes = [
    {
      fileName: "project_auth.md",
      type: "project",
      body: "Refer to [this file](project_auth.md) for history.",
    },
  ];

  const refs = findExplicitReferences(nodes);
  assert.equal(refs.length, 0);
});
```

**Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/memory-index-generator.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// electron/memory-index-generator.ts

export interface MemoryNodeLike {
  fileName: string;
  type: string;
  body: string;
}

export interface Reference {
  from: string;
  to: string;
}

export function findExplicitReferences(nodes: MemoryNodeLike[]): Reference[] {
  const linkRe = /\[([^\]]*)\]\(([^)]+\.md)\)/g;
  const nodeFileNames = new Set(nodes.map((n) => n.fileName));
  const results: Reference[] = [];

  for (const node of nodes) {
    if (node.type === "index") continue;
    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(node.body)) !== null) {
      const target = match[2];
      if (nodeFileNames.has(target) && target !== node.fileName) {
        results.push({ from: node.fileName, to: target });
      }
    }
  }
  return results;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/memory-index-generator.test.ts`
Expected: 3 passing

**Step 5: Commit**

```bash
git add electron/memory-index-generator.ts tests/memory-index-generator.test.ts
git commit -m "feat(memory): add findExplicitReferences for cross-file link extraction"
```

---

## Task 2: Core index generator — `findTimeSensitiveMemories`

**Files:**
- Modify: `electron/memory-index-generator.ts`
- Modify: `tests/memory-index-generator.test.ts`

**Step 1: Write the failing tests**

Append to `tests/memory-index-generator.test.ts`:

```typescript
test("findTimeSensitiveMemories flags dates older than threshold", async () => {
  const { findTimeSensitiveMemories } = await import(
    `../electron/memory-index-generator.ts?time-${Date.now()}`
  );

  // Use a date 30 days ago
  const oldDate = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const nodes = [
    {
      fileName: "project_freeze.md",
      type: "project",
      body: `Merge freeze begins ${oldDate} for mobile release.`,
    },
  ];

  const results = findTimeSensitiveMemories(nodes, 14);
  assert.equal(results.length, 1);
  assert.equal(results[0].fileName, "project_freeze.md");
  assert.equal(results[0].date, oldDate);
  assert.ok(results[0].daysAgo >= 29);
});

test("findTimeSensitiveMemories ignores recent dates", async () => {
  const { findTimeSensitiveMemories } = await import(
    `../electron/memory-index-generator.ts?recent-${Date.now()}`
  );

  const recentDate = new Date().toISOString().slice(0, 10);
  const nodes = [
    {
      fileName: "project_fresh.md",
      type: "project",
      body: `Started on ${recentDate}.`,
    },
  ];

  const results = findTimeSensitiveMemories(nodes, 14);
  assert.equal(results.length, 0);
});

test("findTimeSensitiveMemories skips index nodes", async () => {
  const { findTimeSensitiveMemories } = await import(
    `../electron/memory-index-generator.ts?idx-${Date.now()}`
  );

  const oldDate = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const nodes = [
    {
      fileName: "MEMORY.md",
      type: "index",
      body: `Some old date ${oldDate} in index.`,
    },
  ];

  const results = findTimeSensitiveMemories(nodes, 14);
  assert.equal(results.length, 0);
});

test("findTimeSensitiveMemories reports only one entry per file", async () => {
  const { findTimeSensitiveMemories } = await import(
    `../electron/memory-index-generator.ts?multi-${Date.now()}`
  );

  const d1 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const d2 = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const nodes = [
    {
      fileName: "project_timeline.md",
      type: "project",
      body: `Phase 1: ${d1}. Phase 2: ${d2}.`,
    },
  ];

  const results = findTimeSensitiveMemories(nodes, 14);
  assert.equal(results.length, 1);
});
```

**Step 2: Run tests to verify new ones fail**

Run: `npx tsx --test tests/memory-index-generator.test.ts`
Expected: 3 pass (from Task 1), 4 fail (new)

**Step 3: Write implementation**

Add to `electron/memory-index-generator.ts`:

```typescript
export interface TimeSensitiveEntry {
  fileName: string;
  date: string;
  daysAgo: number;
}

export function findTimeSensitiveMemories(
  nodes: MemoryNodeLike[],
  thresholdDays = 14,
): TimeSensitiveEntry[] {
  const dateRe = /\b(20\d{2}-\d{2}-\d{2})\b/g;
  const results: TimeSensitiveEntry[] = [];
  const now = Date.now();

  for (const node of nodes) {
    if (node.type === "index") continue;
    let match: RegExpExecArray | null;
    while ((match = dateRe.exec(node.body)) !== null) {
      const dateMs = new Date(match[1]).getTime();
      const daysAgo = Math.floor((now - dateMs) / 86400000);
      if (daysAgo > thresholdDays) {
        results.push({ fileName: node.fileName, date: match[1], daysAgo });
        break; // one per file
      }
    }
  }
  return results;
}
```

**Step 4: Run tests**

Run: `npx tsx --test tests/memory-index-generator.test.ts`
Expected: all 7 pass

**Step 5: Commit**

```bash
git add electron/memory-index-generator.ts tests/memory-index-generator.test.ts
git commit -m "feat(memory): add findTimeSensitiveMemories for date expiry warnings"
```

---

## Task 3: Core index generator — `generateEnhancedIndex`

**Files:**
- Modify: `electron/memory-index-generator.ts`
- Modify: `tests/memory-index-generator.test.ts`

**Step 1: Write the failing tests**

Append to `tests/memory-index-generator.test.ts`:

```typescript
test("generateEnhancedIndex produces full memory-graph block", async () => {
  const { generateEnhancedIndex } = await import(
    `../electron/memory-index-generator.ts?gen-${Date.now()}`
  );

  const oldDate = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);

  const nodes = [
    {
      fileName: "MEMORY.md",
      type: "index",
      body: "- [Auth](project_auth.md)",
    },
    {
      fileName: "project_auth.md",
      type: "project",
      body: `Auth rewrite. See [DB policy](feedback_db.md). Freeze was ${oldDate}.`,
    },
    {
      fileName: "feedback_db.md",
      type: "feedback",
      body: "Use real DB in tests.",
    },
  ];

  const output = generateEnhancedIndex(nodes);
  assert.ok(output.includes('<memory-graph source="termcanvas">'));
  assert.ok(output.includes("</memory-graph>"));
  assert.ok(output.includes("project_auth.md → feedback_db.md"));
  assert.ok(output.includes(oldDate));
  assert.ok(output.includes("## References"));
  assert.ok(output.includes("## Time-sensitive"));
});

test("generateEnhancedIndex returns empty string when no signals", async () => {
  const { generateEnhancedIndex } = await import(
    `../electron/memory-index-generator.ts?empty-${Date.now()}`
  );

  const nodes = [
    {
      fileName: "feedback_terse.md",
      type: "feedback",
      body: "No links, no dates.",
    },
  ];

  const output = generateEnhancedIndex(nodes);
  assert.equal(output, "");
});

test("generateEnhancedIndex omits sections with no entries", async () => {
  const { generateEnhancedIndex } = await import(
    `../electron/memory-index-generator.ts?partial-${Date.now()}`
  );

  const nodes = [
    {
      fileName: "project_auth.md",
      type: "project",
      body: "References [feedback_db.md](feedback_db.md).",
    },
    {
      fileName: "feedback_db.md",
      type: "feedback",
      body: "Real DB only.",
    },
  ];

  const output = generateEnhancedIndex(nodes);
  assert.ok(output.includes("## References"));
  assert.ok(!output.includes("## Time-sensitive"));
});
```

**Step 2: Run tests to verify new ones fail**

Run: `npx tsx --test tests/memory-index-generator.test.ts`

**Step 3: Write implementation**

Add to `electron/memory-index-generator.ts`:

```typescript
export function generateEnhancedIndex(nodes: MemoryNodeLike[]): string {
  if (nodes.length === 0) return "";

  const references = findExplicitReferences(nodes);
  const timeSensitive = findTimeSensitiveMemories(nodes);

  if (references.length === 0 && timeSensitive.length === 0) return "";

  let output = '<memory-graph source="termcanvas">\n\n';

  if (references.length > 0) {
    output += "## References\n";
    for (const ref of references) {
      output += `- ${ref.from} → ${ref.to}\n`;
    }
    output += "\n";
  }

  if (timeSensitive.length > 0) {
    output += "## Time-sensitive\n";
    for (const ts of timeSensitive) {
      output += `- ${ts.fileName} — mentions date ${ts.date} (>${ts.daysAgo}d ago)\n`;
    }
    output += "\n";
  }

  output += "</memory-graph>";
  return output;
}
```

**Step 4: Run tests**

Run: `npx tsx --test tests/memory-index-generator.test.ts`
Expected: all 10 pass

**Step 5: Commit**

```bash
git add electron/memory-index-generator.ts tests/memory-index-generator.test.ts
git commit -m "feat(memory): add generateEnhancedIndex to compose memory-graph block"
```

---

## Task 4: Index cache with hash dedup — `MemoryIndexCache`

**Files:**
- Modify: `electron/memory-index-generator.ts`
- Modify: `tests/memory-index-generator.test.ts`

**Step 1: Write the failing tests**

Append to `tests/memory-index-generator.test.ts`:

```typescript
test("MemoryIndexCache writes index and hash files", async () => {
  const { MemoryIndexCache } = await import(
    `../electron/memory-index-generator.ts?cache-${Date.now()}`
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "idx-test-"));
  const cache = new MemoryIndexCache(tmpDir);

  const updated = cache.update("test content");
  assert.equal(updated, true);
  assert.equal(
    fs.readFileSync(path.join(tmpDir, "memory-index.md"), "utf-8"),
    "test content",
  );
  assert.ok(fs.existsSync(path.join(tmpDir, "memory-index.hash")));

  fs.rmSync(tmpDir, { recursive: true });
});

test("MemoryIndexCache skips write when content unchanged", async () => {
  const { MemoryIndexCache } = await import(
    `../electron/memory-index-generator.ts?dedup-${Date.now()}`
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "idx-test-"));
  const cache = new MemoryIndexCache(tmpDir);

  cache.update("same content");
  const mtimeBefore = fs.statSync(
    path.join(tmpDir, "memory-index.md"),
  ).mtimeMs;

  // Small delay to ensure mtime would differ on write
  await new Promise((r) => setTimeout(r, 50));

  const updated = cache.update("same content");
  assert.equal(updated, false);
  const mtimeAfter = fs.statSync(
    path.join(tmpDir, "memory-index.md"),
  ).mtimeMs;
  assert.equal(mtimeBefore, mtimeAfter);

  fs.rmSync(tmpDir, { recursive: true });
});
```

**Step 2: Run tests to verify new ones fail**

Run: `npx tsx --test tests/memory-index-generator.test.ts`

**Step 3: Write implementation**

Add to `electron/memory-index-generator.ts`:

```typescript
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class MemoryIndexCache {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  update(content: string): boolean {
    const hashFile = path.join(this.dir, "memory-index.hash");
    const indexFile = path.join(this.dir, "memory-index.md");

    const newHash = crypto.createHash("md5").update(content).digest("hex");

    try {
      const oldHash = fs.readFileSync(hashFile, "utf-8").trim();
      if (oldHash === newHash) return false;
    } catch {}

    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    fs.writeFileSync(indexFile, content, "utf-8");
    fs.writeFileSync(hashFile, newHash, "utf-8");
    return true;
  }

  read(): string {
    try {
      return fs.readFileSync(
        path.join(this.dir, "memory-index.md"),
        "utf-8",
      );
    } catch {
      return "";
    }
  }
}
```

**Step 4: Run tests**

Run: `npx tsx --test tests/memory-index-generator.test.ts`
Expected: all 12 pass

**Step 5: Commit**

```bash
git add electron/memory-index-generator.ts tests/memory-index-generator.test.ts
git commit -m "feat(memory): add MemoryIndexCache with hash dedup"
```

---

## Task 5: API endpoint — `GET /api/memory/index`

**Files:**
- Modify: `electron/api-server.ts` (add route + handler)

**Step 1: Add the route and handler**

In `api-server.ts`, add a new route in the `route()` method before the 404 throw:

```typescript
// Memory index
if (method === "GET" && pathname === "/api/memory/index") {
  const worktree = url.searchParams.get("worktree");
  return this.memoryIndex(worktree);
}
```

Add handler method:

```typescript
private async memoryIndex(worktree: string | null) {
  if (!worktree) {
    throw Object.assign(new Error("worktree query parameter is required"), {
      status: 400,
    });
  }

  const { getMemoryDirForWorktree, scanMemoryDir } = await import(
    "./memory-service.js"
  );
  const { generateEnhancedIndex } = await import(
    "./memory-index-generator.js"
  );

  const memDir = getMemoryDirForWorktree(worktree);
  const graph = scanMemoryDir(memDir);
  const index = generateEnhancedIndex(graph.nodes);
  return { index };
}
```

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: pass

**Step 3: Commit**

```bash
git add electron/api-server.ts
git commit -m "feat(memory): add GET /api/memory/index endpoint"
```

---

## Task 6: SessionStart hook script + hooks.json

**Files:**
- Create: `skills/hooks/hooks.json`
- Create: `skills/scripts/memory-session-start.sh`

**Step 1: Create hooks.json**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/../scripts/memory-session-start.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Note: empty `matcher` matches all SessionStart events.

**Step 2: Create the shell script**

```bash
#!/bin/bash
# memory-session-start.sh
# Fetch enhanced memory index from TermCanvas API and inject as additionalContext.

PORT_FILE="${TERMCANVAS_PORT_FILE:-$HOME/.termcanvas/port}"
PORT=$(cat "$PORT_FILE" 2>/dev/null || echo "")
if [ -z "$PORT" ]; then
  exit 0
fi

# Determine worktree from CWD
WORKTREE=$(pwd)

RESP=$(curl -s --max-time 5 "http://127.0.0.1:$PORT/api/memory/index?worktree=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$WORKTREE', safe=''))")" 2>/dev/null)
if [ -z "$RESP" ]; then
  exit 0
fi

INDEX=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('index',''))" 2>/dev/null)
if [ -z "$INDEX" ]; then
  exit 0
fi

# Return additionalContext format
python3 -c "
import json, sys
index = sys.stdin.read()
print(json.dumps({
  'hookSpecificOutput': {
    'hookEventName': 'SessionStart',
    'additionalContext': index
  }
}))
" <<< "$INDEX"
```

**Step 3: Make script executable**

Run: `chmod +x skills/scripts/memory-session-start.sh`

**Step 4: Commit**

```bash
git add skills/hooks/hooks.json skills/scripts/memory-session-start.sh
git commit -m "feat(memory): add SessionStart hook for enhanced memory index injection"
```

---

## Task 7: Skill update — Memory Graph navigation instructions

**Files:**
- Modify: `skills/skills/using-termcanvas/SKILL.md`

**Step 1: Append Memory Graph section**

Add to the end of the SKILL.md file:

```markdown

## Memory Graph

When the session context contains a `<memory-graph>` block from TermCanvas:

- Check "References" before reading a memory file — referenced files are likely also relevant, follow the links
- If a memory is marked "Time-sensitive" with a date that has clearly passed, verify its content against current project state before acting on it
- Do not cite memory-graph metadata to the user — it's for your navigation, not for display
```

**Step 2: Commit**

```bash
git add skills/skills/using-termcanvas/SKILL.md
git commit -m "feat(memory): add Memory Graph navigation instructions to skill"
```

---

## Task 8: Wire index regeneration into existing memory:watch

**Files:**
- Modify: `electron/main.ts`

**Step 1: Update the memory:watch handler**

In `electron/main.ts`, find the `memory:watch` handler (around line 593). Update the `watchMemoryDir` callback to also regenerate the enhanced index:

```typescript
ipcMain.handle("memory:watch", async (_event, worktreePath: string) => {
  const { getMemoryDirForWorktree, watchMemoryDir, scanMemoryDir } =
    await import("./memory-service.js");
  const { generateEnhancedIndex, MemoryIndexCache } = await import(
    "./memory-index-generator.js"
  );
  const memDir = getMemoryDirForWorktree(worktreePath);
  const cache = new MemoryIndexCache(dataDir);

  // Generate initial index
  const initialGraph = scanMemoryDir(memDir);
  cache.update(generateEnhancedIndex(initialGraph.nodes));

  watchMemoryDir(memDir, () => {
    const graph = scanMemoryDir(memDir);
    sendToWindow(mainWindow, "memory:changed", graph);
    cache.update(generateEnhancedIndex(graph.nodes));
  });
});
```

`dataDir` is the TermCanvas data directory — check where it's defined in `main.ts` (should be derived from `getTermCanvasDataDir`). Use the same variable.

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: pass

**Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat(memory): regenerate enhanced index on memory file changes"
```

---

## Task 9: Add memory-index-generator test to package.json

**Files:**
- Modify: `package.json`

**Step 1: Add to test script**

Append `tests/memory-index-generator.test.ts` to the `test` script in `package.json`. Also append `tests/memory-service.test.ts` since it's currently missing.

**Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add memory tests to test script"
```

---

## Task 10: Final typecheck + integration smoke test

**Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: pass

**Step 2: Verify the complete flow manually**

1. Start TermCanvas (or use dev instance)
2. Open a project that has Claude Code memory files
3. Hit the API: `curl "http://127.0.0.1:$(cat ~/.termcanvas/port)/api/memory/index?worktree=/path/to/project"`
4. Verify the response contains a `<memory-graph>` block (or empty `index` if no cross-refs/old dates exist)

---

## Summary of new/modified files

| File | Action | Purpose |
|------|--------|---------|
| `electron/memory-index-generator.ts` | Create | Core: findExplicitReferences, findTimeSensitiveMemories, generateEnhancedIndex, MemoryIndexCache |
| `tests/memory-index-generator.test.ts` | Create | Unit tests for the generator |
| `electron/api-server.ts` | Modify | Add `GET /api/memory/index?worktree=` route |
| `electron/main.ts` | Modify | Wire cache.update into memory:watch callback |
| `skills/hooks/hooks.json` | Create | SessionStart hook definition |
| `skills/scripts/memory-session-start.sh` | Create | Hook script: fetch index from API, return as additionalContext |
| `skills/skills/using-termcanvas/SKILL.md` | Modify | Append Memory Graph usage instructions |
| `package.json` | Modify | Add test files to test script |
