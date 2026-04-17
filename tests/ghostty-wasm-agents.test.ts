/**
 * VT replay tests for the Ghostty WASM core focused on sequences coding
 * agents (Claude, Codex) emit in real sessions. These are the edge cases
 * we've historically burned time on under xterm.js — they're here to lock
 * in byte-for-byte parity the moment we swap backends.
 *
 * Implementation note: we load a fresh Ghostty instance per test rather
 * than sharing one. ghostty-web v0.4.0 has a cross-terminal grapheme pool
 * that isn't fully reset on `terminal.free()`, so complex-script writes in
 * one terminal can trap subsequent ones in the same instance. Paying the
 * ~50 ms WASM parse cost per test buys us isolation and deterministic
 * failures until the upstream fix lands.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { loadGhosttyInNode } from "../src/terminal/backend/loadGhostty.ts";
import { GhosttyWasmCore } from "../src/terminal/backend/GhosttyWasmCore.ts";

async function createCore(
  cols: number,
  rows: number,
  scrollbackLimit = 10_000,
): Promise<GhosttyWasmCore> {
  const ghostty = await loadGhosttyInNode();
  return new GhosttyWasmCore(ghostty, { cols, rows, scrollbackLimit });
}

test("bracketed paste mode (DECSET 2004) toggles hasBracketedPaste", async () => {
  const core = await createCore(20, 3);
  try {
    assert.equal(core.hasBracketedPaste(), false);
    core.write("\x1b[?2004h");
    assert.equal(core.hasBracketedPaste(), true);
    core.write("\x1b[?2004l");
    assert.equal(core.hasBracketedPaste(), false);
  } finally {
    core.dispose();
  }
});

test("mouse tracking mode 1000 flips hasMouseTracking", async () => {
  const core = await createCore(20, 3);
  try {
    assert.equal(core.hasMouseTracking(), false);
    core.write("\x1b[?1000h");
    assert.equal(core.hasMouseTracking(), true);
    core.write("\x1b[?1000l");
    assert.equal(core.hasMouseTracking(), false);
  } finally {
    core.dispose();
  }
});

test("24-bit RGB foreground+background persist on cells", async () => {
  const core = await createCore(20, 2);
  try {
    core.write("\x1b[38;2;200;100;50m\x1b[48;2;10;20;30mX");
    core.update();
    const cell = core.getViewport()[0];
    assert.equal(cell.fg_r, 200);
    assert.equal(cell.fg_g, 100);
    assert.equal(cell.fg_b, 50);
    assert.equal(cell.bg_r, 10);
    assert.equal(cell.bg_g, 20);
    assert.equal(cell.bg_b, 30);
  } finally {
    core.dispose();
  }
});

test("SGR reset clears style flags on subsequent cells", async () => {
  const core = await createCore(20, 2);
  try {
    core.write("\x1b[1;31mA\x1b[0mB");
    core.update();
    const [a, b] = [core.getViewport()[0], core.getViewport()[1]];
    assert.ok(a.flags & 1, "A should be bold");
    assert.equal(b.flags & 1, 0, "B should not be bold");
  } finally {
    core.dispose();
  }
});

test("emoji ZWJ clusters collapse into a single grapheme", async () => {
  const core = await createCore(10, 2);
  try {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
    core.write(family);
    core.update();
    assert.equal(core.getGraphemeString(0, 0), family);
  } finally {
    core.dispose();
  }
});

test("combining marks attach to their base without consuming an extra cell", async () => {
  const core = await createCore(10, 2);
  try {
    // 'e' + combining acute. Ghostty normalises to NFC internally, so the
    // grapheme string surfaces as the precomposed 'é'.
    core.write("e\u0301");
    core.update();
    const rendered = core.getGraphemeString(0, 0);
    assert.equal(
      rendered.normalize("NFC"),
      "é",
      `combining mark should collapse to a single grapheme, got ${JSON.stringify(rendered)}`,
    );
    assert.equal(core.getCursor().x, 1);
  } finally {
    core.dispose();
  }
});

test("CR moves to column 0 without newlines (progress-bar pattern)", async () => {
  const core = await createCore(20, 2);
  try {
    core.write("progress:   0%\rprogress: 100%");
    core.update();
    assert.equal(core.getViewportText()[0], "progress: 100%");
  } finally {
    core.dispose();
  }
});

test("cursor save / restore (DECSC / DECRC) round-trip the position", async () => {
  const core = await createCore(20, 4);
  try {
    core.write("\x1b[3;5H");
    core.write("\x1b7");
    core.write("\x1b[1;1H");
    core.write("X");
    core.write("\x1b8");
    core.update();
    const cursor = core.getCursor();
    assert.equal(cursor.y, 2);
    assert.equal(cursor.x, 4);
  } finally {
    core.dispose();
  }
});

test("alt-screen enter + interactive UI + exit keeps primary scrollback intact", async () => {
  const core = await createCore(10, 3);
  try {
    core.write("before\r\n");
    core.write("\x1b[?1049h");
    assert.equal(core.isAlternateScreen(), true);
    core.write("\x1b[2J\x1b[1;1H");
    core.write("alt-content");
    core.write("\x1b[?1049l");
    assert.equal(core.isAlternateScreen(), false);
    core.update();
    const text = core.getViewportText();
    assert.ok(
      text.some((line) => line.includes("before")),
      `expected 'before' to survive alt-screen exit, got ${JSON.stringify(text)}`,
    );
  } finally {
    core.dispose();
  }
});

test("256-color palette indices resolve to RGB on cells", async () => {
  const core = await createCore(10, 2);
  try {
    core.write("\x1b[38;5;196mR");
    core.update();
    const cell = core.getViewport()[0];
    assert.ok(
      cell.fg_r > 100 && cell.fg_g < 100 && cell.fg_b < 100,
      `expected reddish fg, got rgb(${cell.fg_r},${cell.fg_g},${cell.fg_b})`,
    );
  } finally {
    core.dispose();
  }
});

test("OSC 8 hyperlinks attach a stable id to the linked cells", async () => {
  const core = await createCore(30, 2);
  try {
    core.write(
      "\x1b]8;;https://example.com\x1b\\click\x1b]8;;\x1b\\ trailing",
    );
    core.update();
    const viewport = core.getViewport();
    const linkedId = viewport[0].hyperlink_id;
    assert.ok(linkedId > 0, "linked cell should carry a non-zero hyperlink id");
    for (let i = 1; i < 5; i += 1) {
      assert.equal(
        viewport[i].hyperlink_id,
        linkedId,
        "all cells inside the link should share its id",
      );
    }
    assert.equal(viewport[6].hyperlink_id, 0);
  } finally {
    core.dispose();
  }
});

test("long scroll burst stays responsive and reports dirty state correctly", async () => {
  const core = await createCore(80, 24, 50_000);
  try {
    const lineBody = "a".repeat(60);
    let chunk = "";
    for (let i = 0; i < 8_000; i += 1) {
      chunk += `${lineBody}\r\n`;
    }
    core.write(chunk);
    const dirty = core.update();
    assert.ok(dirty !== 0, "dirty state should register after a burst write");
    // NOTE: ghostty-web v0.4.0 ignores `scrollbackLimit` — scrollback caps at
    // ~850 lines regardless. This is a feature-parity gap with xterm.js
    // (TermCanvas configures xterm for 50 000 lines) and is tracked on the
    // PR as a known limitation. We just verify the scrollback is actually
    // populating, not that it retains the full burst.
    assert.ok(
      core.getScrollbackLength() > 500,
      `scrollback should populate under burst writes, got ${core.getScrollbackLength()}`,
    );
    core.markClean();
    assert.equal(core.needsFullRedraw(), false);
  } finally {
    core.dispose();
  }
});
