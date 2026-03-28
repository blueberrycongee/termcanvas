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
