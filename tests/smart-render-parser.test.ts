import test from "node:test";
import assert from "node:assert/strict";
import { SmartRenderParser } from "../src/terminal/smartRender/parser.ts";

test("emits raw segment for plain text", () => {
  const parser = new SmartRenderParser();
  const segments = parser.feed("hello world\n", "hello world\n");
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, "raw");
  assert.equal(segments[0].content, "hello world\n");
  assert.equal(segments[0].status, "complete");
});

test("detects fenced code block", () => {
  const parser = new SmartRenderParser();
  const s1 = parser.feed("```typescript\n", "```typescript\n");
  assert.equal(s1.length, 1);
  assert.equal(s1[0].type, "code_block");
  assert.equal(s1[0].status, "pending");
  assert.equal(s1[0].meta?.language, "typescript");

  const s2 = parser.feed("const x = 1;\n```\n", "const x = 1;\n```\n");
  const completed = s2.find((s) => s.type === "code_block" && s.status === "complete");
  assert.ok(completed);
  assert.match(completed!.content, /const x = 1/);
});

test("detects markdown heading", () => {
  const parser = new SmartRenderParser();
  const segments = parser.feed("# Hello World\n", "# Hello World\n");
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, "markdown");
});

test("detects diff block", () => {
  const parser = new SmartRenderParser();
  const segments = parser.feed("--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n-old\n+new\n\n", "--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n-old\n+new\n\n");
  const diff = segments.find((s) => s.type === "diff");
  assert.ok(diff);
});

test("handles streaming chunks across feed calls", () => {
  const parser = new SmartRenderParser();
  parser.feed("```py", "```py");
  const s2 = parser.feed("thon\nprint('hi')\n", "thon\nprint('hi')\n");
  const pending = s2.find((s) => s.type === "code_block");
  assert.ok(pending);

  const s3 = parser.feed("```\n", "```\n");
  const complete = s3.find((s) => s.type === "code_block" && s.status === "complete");
  assert.ok(complete);
});

test("detects thinking block markers", () => {
  const parser = new SmartRenderParser();
  const s1 = parser.feed("<thinking>\n", "<thinking>\n");
  assert.equal(s1[0]?.type, "thinking");
  assert.equal(s1[0]?.status, "pending");

  const s2 = parser.feed("reasoning here\n</thinking>\n", "reasoning here\n</thinking>\n");
  const complete = s2.find((s) => s.type === "thinking" && s.status === "complete");
  assert.ok(complete);
});

test("counts lines correctly across segments", () => {
  const parser = new SmartRenderParser();
  parser.feed("line one\n", "line one\n");
  const s2 = parser.feed("line two\nline three\n", "line two\nline three\n");
  const last = s2[s2.length - 1];
  assert.ok(last.startLine >= 1);
});

test("reset clears all state", () => {
  const parser = new SmartRenderParser();
  parser.feed("```typescript\ncode\n", "```typescript\ncode\n");
  parser.reset();
  const segments = parser.feed("plain text\n", "plain text\n");
  assert.equal(segments[0].type, "raw");
  assert.equal(segments[0].startLine, 0);
});

test("initialLineOffset shifts startLine", () => {
  const parser = new SmartRenderParser(100);
  const segments = parser.feed("hello\n", "hello\n");
  assert.equal(segments[0].startLine, 100);
});
