import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

test("parseMemoryFile extracts frontmatter and body", async () => {
  const { parseMemoryFile } = await import(
    `../electron/memory-service.ts?parse-${Date.now()}`
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-test-"));
  const filePath = path.join(tmpDir, "feedback_test.md");
  fs.writeFileSync(
    filePath,
    `---
name: test memory
description: a test memory file
type: feedback
---

This is the body content.

**Why:** testing
`,
  );

  const result = parseMemoryFile(filePath);
  assert.equal(result.name, "test memory");
  assert.equal(result.description, "a test memory file");
  assert.equal(result.type, "feedback");
  assert.ok(result.body.includes("This is the body content."));
  assert.equal(result.fileName, "feedback_test.md");
  assert.ok(result.mtime > 0);

  fs.rmSync(tmpDir, { recursive: true });
});

test("parseMemoryFile returns null for non-existent file", async () => {
  const { parseMemoryFile } = await import(
    `../electron/memory-service.ts?nofile-${Date.now()}`
  );
  const result = parseMemoryFile("/tmp/does-not-exist.md");
  assert.equal(result, null);
});

test("parseMemoryFile handles file without frontmatter", async () => {
  const { parseMemoryFile } = await import(
    `../electron/memory-service.ts?nofm-${Date.now()}`
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-test-"));
  const filePath = path.join(tmpDir, "plain.md");
  fs.writeFileSync(filePath, "Just plain markdown content.\n");

  const result = parseMemoryFile(filePath);
  assert.ok(result);
  assert.equal(result.name, "plain");
  assert.equal(result.type, "unknown");
  assert.ok(result.body.includes("Just plain markdown"));

  fs.rmSync(tmpDir, { recursive: true });
});

test("scanMemoryDir returns graph with nodes and edges from MEMORY.md", async () => {
  const { scanMemoryDir } = await import(
    `../electron/memory-service.ts?scan-${Date.now()}`
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-test-"));

  fs.writeFileSync(
    path.join(tmpDir, "MEMORY.md"),
    `- [Hydra watch](feedback_hydra_watch.md) — always poll after dispatch
- [Hydra approve](feedback_hydra_approve.md) — need --auto-approve
`,
  );

  fs.writeFileSync(
    path.join(tmpDir, "feedback_hydra_watch.md"),
    `---
name: hydra-auto-watch
description: After launching Hydra workflows, immediately enter watch polling loop
type: feedback
---

Watch after dispatch.
`,
  );

  fs.writeFileSync(
    path.join(tmpDir, "feedback_hydra_approve.md"),
    `---
name: Hydra must use --auto-approve
description: Spawned CLIs need --auto-approve
type: feedback
---

Always pass --auto-approve.
`,
  );

  const graph = scanMemoryDir(tmpDir);

  assert.equal(graph.nodes.length, 3);
  const memoryNode = graph.nodes.find((n) => n.fileName === "MEMORY.md");
  assert.ok(memoryNode);
  assert.equal(memoryNode.type, "index");

  assert.equal(graph.edges.length, 2);
  assert.ok(graph.edges.every((e) => e.source === "MEMORY.md"));
  const targets = graph.edges.map((e) => e.target).sort();
  assert.deepEqual(targets, ["feedback_hydra_approve.md", "feedback_hydra_watch.md"]);

  fs.rmSync(tmpDir, { recursive: true });
});

test("scanMemoryDir returns empty graph for non-existent dir", async () => {
  const { scanMemoryDir } = await import(
    `../electron/memory-service.ts?empty-${Date.now()}`
  );
  const graph = scanMemoryDir("/tmp/does-not-exist-dir-" + Date.now());
  assert.equal(graph.nodes.length, 0);
  assert.equal(graph.edges.length, 0);
});

test("scanMemoryDir handles empty directory", async () => {
  const { scanMemoryDir } = await import(
    `../electron/memory-service.ts?emptydir-${Date.now()}`
  );
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-test-"));
  const graph = scanMemoryDir(tmpDir);
  assert.equal(graph.nodes.length, 0);
  assert.equal(graph.edges.length, 0);
  fs.rmSync(tmpDir, { recursive: true });
});

test("getMemoryDirForWorktree derives correct Claude Code memory path", async () => {
  const { getMemoryDirForWorktree } = await import(
    `../electron/memory-service.ts?derive-${Date.now()}`
  );
  const result = getMemoryDirForWorktree("/Users/zzzz/termcanvas");
  const normalized = result.replace(/\\/g, "/");
  assert.ok(normalized.endsWith("/-Users-zzzz-termcanvas/memory"));
  assert.ok(normalized.includes(".claude/projects"));
});

test("getMemoryDirForWorktree handles Windows paths", async () => {
  const { getMemoryDirForWorktree } = await import(
    `../electron/memory-service.ts?win-${Date.now()}`
  );
  const result = getMemoryDirForWorktree("C:\\Users\\test\\project");
  assert.ok(!result.includes("\\\\") || process.platform === "win32");
  assert.ok(result.includes("C-"));
});
