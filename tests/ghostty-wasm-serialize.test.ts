/**
 * Round-trip tests for Ghostty's screen → ANSI serializer.
 *
 * For each input, we:
 *   1. write bytes into a fresh Ghostty core
 *   2. serialize the screen
 *   3. write the serialized bytes into a second fresh core
 *   4. assert the visible text matches between the two
 *
 * Byte-exact equality is NOT the bar here — SerializeAddon doesn't
 * round-trip byte-for-byte either — but the rendered grid (characters +
 * style flags on each cell) must be the same, which is what downstream
 * consumers actually care about when resuming scrollback.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { loadGhosttyInNode } from "../src/terminal/backend/loadGhostty.ts";
import { GhosttyWasmCore } from "../src/terminal/backend/GhosttyWasmCore.ts";

async function freshCore(
  cols: number,
  rows: number,
): Promise<GhosttyWasmCore> {
  const ghostty = await loadGhosttyInNode();
  return new GhosttyWasmCore(ghostty, { cols, rows });
}

async function roundTrip(
  cols: number,
  rows: number,
  input: string,
): Promise<{ a: GhosttyWasmCore; b: GhosttyWasmCore; serialized: string }> {
  const a = await freshCore(cols, rows);
  a.write(input);
  a.update();
  const serialized = a.serialize();

  const b = await freshCore(cols, rows);
  b.write(serialized);
  b.update();
  return { a, b, serialized };
}

test("plain ASCII round-trips through serialize", async () => {
  const { a, b } = await roundTrip(20, 3, "hello world\r\nsecond line");
  try {
    assert.deepEqual(b.getViewportText(), a.getViewportText());
  } finally {
    a.dispose();
    b.dispose();
  }
});

test("truecolor fg/bg round-trips through serialize", async () => {
  const { a, b } = await roundTrip(
    20,
    2,
    "\x1b[38;2;200;100;50m\x1b[48;2;10;20;30mX\x1b[0mY",
  );
  try {
    const [aCell0, aCell1] = [a.getViewport()[0], a.getViewport()[1]];
    const [bCell0, bCell1] = [b.getViewport()[0], b.getViewport()[1]];
    assert.deepEqual(
      { r: bCell0.fg_r, g: bCell0.fg_g, b: bCell0.fg_b },
      { r: aCell0.fg_r, g: aCell0.fg_g, b: aCell0.fg_b },
    );
    assert.deepEqual(
      { r: bCell0.bg_r, g: bCell0.bg_g, b: bCell0.bg_b },
      { r: aCell0.bg_r, g: aCell0.bg_g, b: aCell0.bg_b },
    );
    // The 'Y' after reset should have default colours on both sides.
    assert.equal(bCell1.fg_r, aCell1.fg_r);
    assert.equal(bCell1.bg_r, aCell1.bg_r);
  } finally {
    a.dispose();
    b.dispose();
  }
});

test("bold + italic + underline flags round-trip through serialize", async () => {
  const { a, b } = await roundTrip(20, 2, "\x1b[1;3;4mbold-italic-underline");
  try {
    for (let i = 0; i < 5; i += 1) {
      assert.equal(b.getViewport()[i].flags, a.getViewport()[i].flags);
    }
  } finally {
    a.dispose();
    b.dispose();
  }
});

test("scrollback content appears in the round-tripped viewport", async () => {
  const lines: string[] = [];
  for (let i = 0; i < 20; i += 1) lines.push(`row-${i}`);
  const input = lines.join("\r\n");
  const { a, b } = await roundTrip(20, 4, input);
  try {
    // Both should have the same last 4 visible rows, and both should have
    // populated scrollback from the earlier rows.
    assert.deepEqual(b.getViewportText(), a.getViewportText());
    assert.ok(
      b.getScrollbackLength() > 0,
      "scrollback should populate after replaying serialized output",
    );
  } finally {
    a.dispose();
    b.dispose();
  }
});

test("serialize output is idempotent: serialize ∘ write ∘ serialize matches", async () => {
  const a = await freshCore(20, 3);
  try {
    a.write("\x1b[31mred\x1b[0m plain\r\n\x1b[1mbold\x1b[0m");
    a.update();
    const first = a.serialize();

    const b = await freshCore(20, 3);
    try {
      b.write(first);
      b.update();
      const second = b.serialize();
      assert.equal(
        second,
        first,
        "a serialize fed back in should reproduce itself exactly",
      );
    } finally {
      b.dispose();
    }
  } finally {
    a.dispose();
  }
});
