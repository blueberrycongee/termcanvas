import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTaskComposerPayload } from "../electron/task-dispatch.ts";

function freshAttachmentsDir(taskId: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-task-dispatch-"));
  const dir = path.join(root, `${taskId}.attachments`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

test("buildTaskComposerPayload extracts image refs and strips them from text", async () => {
  const taskId = "fix-button-aa11";
  const dir = freshAttachmentsDir(taskId);
  fs.writeFileSync(path.join(dir, "abc123.png"), PNG_BYTES);
  fs.writeFileSync(path.join(dir, "def456.jpg"), JPG_BYTES);

  const body = [
    "Here is the bug.",
    "",
    `![first shot](./${taskId}.attachments/abc123.png)`,
    "",
    "Some prose between images.",
    "",
    `![second shot](./${taskId}.attachments/def456.jpg)`,
    "",
    "Compare with [the spec](https://example.com/spec.pdf).",
  ].join("\n");

  const result = await buildTaskComposerPayload(
    { id: taskId, title: "fix button alignment", body },
    dir,
  );

  assert.equal(result.images.length, 2);
  assert.equal(result.images[0].id, "abc123");
  assert.equal(result.images[0].name, "first shot");
  assert.match(result.images[0].dataUrl, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  assert.equal(result.images[1].id, "def456");
  assert.equal(result.images[1].name, "second shot");
  assert.match(result.images[1].dataUrl, /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/);

  assert.ok(!result.text.includes("abc123.png"));
  assert.ok(!result.text.includes("def456.jpg"));
  assert.ok(result.text.includes("Here is the bug."));
  assert.ok(result.text.includes("Some prose between images."));
  // Non-image links must survive untouched.
  assert.ok(result.text.includes("[the spec](https://example.com/spec.pdf)"));
});

test("buildTaskComposerPayload prepends the task title as h1 markdown", async () => {
  const dir = freshAttachmentsDir("plain-task-aa11");
  const body = "Just some prose.\n\nWith another paragraph.";
  const result = await buildTaskComposerPayload(
    { id: "plain-task-aa11", title: "fix the layout", body },
    dir,
  );
  assert.equal(
    result.text,
    `# fix the layout\n\nJust some prose.\n\nWith another paragraph.`,
  );
  assert.deepEqual(result.images, []);
});

test("buildTaskComposerPayload prepends the title even when the body has image refs", async () => {
  const taskId = "with-image-cc33";
  const dir = freshAttachmentsDir(taskId);
  fs.writeFileSync(path.join(dir, "shot.png"), PNG_BYTES);
  const body = `Look:\n\n![](./${taskId}.attachments/shot.png)`;
  const result = await buildTaskComposerPayload(
    { id: taskId, title: "broken button", body },
    dir,
  );
  assert.ok(result.text.startsWith("# broken button\n\n"));
  assert.ok(result.text.includes("Look:"));
  assert.ok(!result.text.includes("shot.png"));
  assert.equal(result.images.length, 1);
});

test("buildTaskComposerPayload omits the title prefix when the title is blank", async () => {
  const dir = freshAttachmentsDir("untitled-dd44");
  const result = await buildTaskComposerPayload(
    { id: "untitled-dd44", title: "   ", body: "Just body." },
    dir,
  );
  assert.equal(result.text, "Just body.");
});

test("buildTaskComposerPayload skips image refs whose file is missing", async () => {
  const taskId = "missing-asset-bb22";
  const dir = freshAttachmentsDir(taskId);
  // Don't write the file.
  const body = `Here: ![missing](./${taskId}.attachments/ghost.png)`;
  const result = await buildTaskComposerPayload(
    { id: taskId, title: "fix button alignment", body },
    dir,
  );
  assert.equal(result.images.length, 0);
  // The markdown reference should remain in text since we couldn't honor it.
  assert.ok(result.text.includes("ghost.png"));
});
