import test from "node:test";
import assert from "node:assert/strict";
import { SmartRenderPipeline } from "../src/terminal/smartRender/pipeline.ts";

test("pipeline strips ANSI before parsing", () => {
  const pipeline = new SmartRenderPipeline();
  const segments = pipeline.feed("\x1b[1m```typescript\x1b[0m\n\x1b[32mconst x = 1;\x1b[0m\n```\n");
  const codeBlock = segments.find((s) => s.type === "code_block" && s.status === "complete");
  assert.ok(codeBlock);
  assert.equal(codeBlock!.content.includes("\x1b"), false);
  assert.ok(codeBlock!.rawContent.includes("\x1b"));
});

test("pipeline tracks both stripped and raw content", () => {
  const pipeline = new SmartRenderPipeline();
  const segments = pipeline.feed("\x1b[34m# Hello\x1b[0m\n");
  assert.equal(segments[0].content, "# Hello\n");
  assert.ok(segments[0].rawContent.includes("\x1b[34m"));
});

test("getSegments returns all accumulated segments", () => {
  const pipeline = new SmartRenderPipeline();
  pipeline.feed("line 1\n");
  pipeline.feed("line 2\n");
  assert.ok(pipeline.getSegments().length >= 2);
});

test("reset clears pipeline state", () => {
  const pipeline = new SmartRenderPipeline();
  pipeline.feed("```\ncode\n");
  pipeline.reset();
  assert.equal(pipeline.getSegments().length, 0);
});

test("initialLineOffset shifts segment startLine values", () => {
  const pipeline = new SmartRenderPipeline(50);
  pipeline.feed("hello world\n");
  const segments = pipeline.getSegments();
  assert.ok(segments[0].startLine >= 50, "startLine should be offset by initialLineOffset");
});

test("checkTimeouts force-flushes old pending segments", () => {
  const pipeline = new SmartRenderPipeline();
  pipeline.feed("```typescript\ncode here\n");
  const pending = pipeline.getSegments().find((s) => s.status === "pending");
  assert.ok(pending);

  // Manually backdate createdAt to simulate timeout
  (pending as { createdAt: number }).createdAt = Date.now() - 11_000;

  const flushed = pipeline.checkTimeouts();
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].type, "raw");
  assert.equal(flushed[0].status, "complete");
});
