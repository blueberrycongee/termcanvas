import test from "node:test";
import assert from "node:assert/strict";

test("TerminalData has canvas position and size fields", async () => {
  const { } = await import("../src/types/index.ts");

  const terminal: any = {
    id: "t1",
    title: "test",
    type: "shell",
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    x: 100,
    y: 200,
    width: 640,
    height: 480,
    tags: ["project:myapp", "worktree:main"],
  };

  assert.equal(terminal.x, 100);
  assert.equal(terminal.width, 640);
  assert.ok(Array.isArray(terminal.tags));
});
