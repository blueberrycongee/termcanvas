import test from "node:test";
import assert from "node:assert/strict";

import { loadGhosttyInNode } from "../src/terminal/backend/loadGhostty.ts";
import { GhosttyWasmCore } from "../src/terminal/backend/GhosttyWasmCore.ts";

// Shared across tests in this file — WASM compilation is ~50 ms on this host
// and there's no reason to pay it per test.
const ghosttyPromise = loadGhosttyInNode();

async function createCore(cols: number, rows: number): Promise<GhosttyWasmCore> {
  const ghostty = await ghosttyPromise;
  return new GhosttyWasmCore(ghostty, { cols, rows });
}

test("plain ASCII writes land in the expected cells", async () => {
  const core = await createCore(20, 3);
  try {
    core.write("hello");
    assert.equal(core.getViewportText()[0], "hello");
    assert.equal(core.getCursor().x, 5);
    assert.equal(core.getCursor().y, 0);
  } finally {
    core.dispose();
  }
});

test("CSI cursor position (CUP) moves the cursor before the next write", async () => {
  const core = await createCore(20, 4);
  try {
    // ESC[2;5H -> 1-indexed row 2, col 5  ->  0-indexed (1, 4)
    core.write("\x1b[2;5HX");
    const cursor = core.getCursor();
    assert.equal(cursor.y, 1);
    assert.equal(cursor.x, 5);
    assert.equal(core.getViewportText()[1], "    X");
  } finally {
    core.dispose();
  }
});

test("alt screen enter/exit toggles the isAlternateScreen flag", async () => {
  const core = await createCore(10, 3);
  try {
    assert.equal(core.isAlternateScreen(), false);
    core.write("primary");
    core.write("\x1b[?1049h"); // enter alt screen
    assert.equal(core.isAlternateScreen(), true);
    core.write("\x1b[?1049l"); // leave alt screen
    assert.equal(core.isAlternateScreen(), false);
    assert.equal(core.getViewportText()[0], "primary");
  } finally {
    core.dispose();
  }
});

test("wide CJK characters occupy two cells and single-cell followers don't overlap", async () => {
  const core = await createCore(10, 2);
  try {
    // 中 is width-2; plain a, b, c should sit in cells 2..4. Use the
    // grapheme API for the character readout (the raw .codepoint field
    // encodes a pool slot for wide chars, not the Unicode scalar).
    core.write("中abc");
    core.update();
    assert.equal(core.getGraphemeString(0, 0), "中");
    assert.equal(core.getGraphemeString(0, 2), "a");
    assert.equal(core.getGraphemeString(0, 3), "b");
    assert.equal(core.getGraphemeString(0, 4), "c");

    // The raw viewport should still report width=2 on the wide cell and
    // width=0 on the "follower" slot so renderers can tell them apart.
    const viewport = core.getViewport();
    const cols = core.cols;
    assert.equal(viewport[0 * cols + 0].width, 2);
    assert.equal(viewport[0 * cols + 1].width, 0);
  } finally {
    core.dispose();
  }
});

test("DSR 6 (cursor position report) produces a response the backend can read", async () => {
  const core = await createCore(10, 3);
  try {
    // Move cursor, then ask for a DSR 6 report.
    core.write("\x1b[2;3H");
    core.write("\x1b[6n");
    assert.equal(core.hasResponse(), true);
    const response = core.readResponse();
    assert.ok(response);
    // Standard form is ESC[row;colR — must match the position we set.
    assert.match(response, /\x1b\[2;3R/);
  } finally {
    core.dispose();
  }
});

test("scrollback fills as content pushes past the viewport top", async () => {
  const core = await createCore(10, 3);
  try {
    // Write five rows of distinct content; only three fit, so two must land
    // in scrollback once the screen scrolls.
    for (let i = 0; i < 5; i += 1) {
      core.write(`row${i}\r\n`);
    }
    const scrollbackLength = core.getScrollbackLength();
    assert.ok(
      scrollbackLength >= 2,
      `scrollback should retain overflowed rows, got ${scrollbackLength}`,
    );
  } finally {
    core.dispose();
  }
});

test("markClean clears dirty state until the next write", async () => {
  const core = await createCore(10, 3);
  try {
    core.write("hello");
    core.update();
    assert.equal(core.isRowDirty(0), true);
    core.markClean();
    assert.equal(core.isRowDirty(0), false);
    core.write("world");
    core.update();
    assert.equal(core.isRowDirty(0), true);
  } finally {
    core.dispose();
  }
});

test("resize reshapes cols and rows without crashing", async () => {
  const core = await createCore(10, 3);
  try {
    core.write("abc");
    core.resize(40, 10);
    assert.equal(core.cols, 40);
    assert.equal(core.rows, 10);
    // Contents should still be there after resize.
    assert.match(core.getViewportText()[0], /^abc/);
  } finally {
    core.dispose();
  }
});

test("batched write of many bytes succeeds in a single boundary crossing", async () => {
  const core = await createCore(80, 24);
  try {
    // 16 KB chunk of alternating ASCII — no escape sequences — should not
    // blow up under any boundary- or buffer-sizing bug.
    const chunk = "a".repeat(8192) + "b".repeat(8192);
    core.write(chunk);
    // Just assert the terminal is still sane afterwards.
    assert.equal(core.cols, 80);
    assert.equal(core.rows, 24);
    core.update();
  } finally {
    core.dispose();
  }
});
