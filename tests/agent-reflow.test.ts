import test from "node:test";
import assert from "node:assert/strict";

import {
  snapshotBuffer,
  reflowSnapshot,
  type BufferSnapshot,
  type LogicalLine,
} from "../src/terminal/agentReflow.ts";

function makeLine(text: string, isWrapped = false, widths?: number[]) {
  const w = widths ?? Array.from(text, () => 1);
  return {
    isWrapped,
    translateToString(_trimRight?: boolean) {
      return text;
    },
    length: text.length,
    getCell(col: number) {
      if (col < 0 || col >= w.length) return undefined;
      return { getWidth: () => w[col] };
    },
  };
}

function makeSource(lines: ReturnType<typeof makeLine>[], cols: number) {
  return {
    buffer: {
      active: {
        length: lines.length,
        getLine(i: number) {
          return lines[i];
        },
      },
    },
  };
}

test("snapshotBuffer joins wrapped lines into logical lines", () => {
  const source = makeSource(
    [
      makeLine("hello "),
      makeLine("world", true),
    ],
    80,
  );
  const snap = snapshotBuffer(source, 80);
  assert.equal(snap.lines.length, 1);
  assert.equal(snap.lines[0].text, "hello world");
});

test("snapshotBuffer keeps non-wrapped lines separate", () => {
  const source = makeSource(
    [
      makeLine("line one"),
      makeLine("line two"),
    ],
    80,
  );
  const snap = snapshotBuffer(source, 80);
  assert.equal(snap.lines.length, 2);
  assert.equal(snap.lines[0].text, "line one");
  assert.equal(snap.lines[1].text, "line two");
});

test("reflowSnapshot wraps a long line to narrower columns", () => {
  const snap: BufferSnapshot = {
    lines: [{ text: "abcdefghij", widths: Array(10).fill(1) }],
    cols: 10,
  };
  const result = reflowSnapshot(snap, 5);
  assert.deepEqual(result.rows, ["abcde", "fghij"]);
});

test("reflowSnapshot handles wider target (no re-wrap needed)", () => {
  const snap: BufferSnapshot = {
    lines: [{ text: "short", widths: Array(5).fill(1) }],
    cols: 5,
  };
  const result = reflowSnapshot(snap, 80);
  assert.deepEqual(result.rows, ["short"]);
});

test("reflowSnapshot preserves empty lines", () => {
  const snap: BufferSnapshot = {
    lines: [
      { text: "a", widths: [1] },
      { text: "", widths: [] },
      { text: "b", widths: [1] },
    ],
    cols: 80,
  };
  const result = reflowSnapshot(snap, 80);
  assert.deepEqual(result.rows, ["a", "", "b"]);
});

test("reflowSnapshot handles wide characters at column boundary", () => {
  // "A" (width 1) + "全" (width 2) + "B" (width 1) = 4 cols total
  const snap: BufferSnapshot = {
    lines: [{ text: "A全B", widths: [1, 2, 1] }],
    cols: 80,
  };
  const result = reflowSnapshot(snap, 3);
  assert.deepEqual(result.rows, ["A全", "B"]);
});

test("reflowSnapshot wraps before wide char that would overflow", () => {
  // "AB" (width 1+1=2) + "全" (width 2) = 4 cols total
  const snap: BufferSnapshot = {
    lines: [{ text: "AB全", widths: [1, 1, 2] }],
    cols: 80,
  };
  const result = reflowSnapshot(snap, 3);
  assert.deepEqual(result.rows, ["AB", "全"]);
});

test("reflowSnapshot handles multiple logical lines", () => {
  const snap: BufferSnapshot = {
    lines: [
      { text: "abcdef", widths: [1, 1, 1, 1, 1, 1] },
      { text: "ghij", widths: [1, 1, 1, 1] },
    ],
    cols: 10,
  };
  const result = reflowSnapshot(snap, 4);
  assert.deepEqual(result.rows, ["abcd", "ef", "ghij"]);
});

test("round-trip: snapshot then reflow to same cols is identity-like", () => {
  const text = "hello world this is test";
  const source = makeSource(
    [makeLine(text)],
    80,
  );
  const snap = snapshotBuffer(source, 80);
  const result = reflowSnapshot(snap, 80);
  assert.deepEqual(result.rows, [text]);
});
