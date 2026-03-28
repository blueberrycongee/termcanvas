import test from "node:test";
import assert from "node:assert/strict";
import { SmartRenderPipeline } from "../src/terminal/smartRender/pipeline.ts";
import { isInViewport } from "../src/terminal/smartRender/overlayPosition.ts";

test("full pipeline: ANSI code block → positioned overlay", () => {
  const pipeline = new SmartRenderPipeline();

  pipeline.feed("Here is the code:\n");
  pipeline.feed("\x1b[1m```typescript\x1b[0m\n");
  pipeline.feed("\x1b[32mfunction hello() {\x1b[0m\n");
  pipeline.feed("\x1b[32m  return 'world';\x1b[0m\n");
  pipeline.feed("\x1b[32m}\x1b[0m\n");
  pipeline.feed("```\n");
  pipeline.feed("That's it!\n");

  const segments = pipeline.getSegments();
  const codeBlock = segments.find((s) => s.type === "code_block");
  assert.ok(codeBlock, "should have a code_block segment");
  assert.equal(codeBlock!.status, "complete");
  assert.equal(codeBlock!.meta?.language, "typescript");
  assert.equal(codeBlock!.content.includes("\x1b"), false, "content should be ANSI-stripped");
  assert.ok(codeBlock!.rawContent.includes("\x1b"), "rawContent should preserve ANSI");

  assert.ok(isInViewport(codeBlock!.startLine, codeBlock!.lineCount, 0, 30));
});

test("pipeline handles interleaved content types", () => {
  const pipeline = new SmartRenderPipeline();
  pipeline.feed("# Summary\n");
  pipeline.feed("Some text here\n");
  pipeline.feed("```bash\necho hello\n```\n");
  pipeline.feed("<thinking>\nLet me think...\n</thinking>\n");

  const segments = pipeline.getSegments();
  const types = segments.map((s) => s.type);
  assert.ok(types.includes("markdown"), "should detect markdown");
  assert.ok(types.includes("code_block"), "should detect code block");
  assert.ok(types.includes("thinking"), "should detect thinking block");
});

test("pipeline with initial offset produces correct absolute line numbers", () => {
  const pipeline = new SmartRenderPipeline(100);
  pipeline.feed("plain text\n");
  pipeline.feed("```js\nconst x = 1;\n```\n");

  const segments = pipeline.getSegments();
  for (const s of segments) {
    assert.ok(s.startLine >= 100, `segment startLine ${s.startLine} should be >= 100`);
  }
});

test("pipeline reset clears everything and restarts line counting", () => {
  const pipeline = new SmartRenderPipeline(50);
  pipeline.feed("# Heading\n");
  pipeline.feed("```\ncode\n```\n");
  assert.ok(pipeline.getSegments().length > 0);

  pipeline.reset();
  assert.equal(pipeline.getSegments().length, 0);
});
