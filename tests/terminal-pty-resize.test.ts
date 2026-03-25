import test from "node:test";
import assert from "node:assert/strict";

import * as ptyResize from "../src/terminal/ptyResize.ts";

test("pty resize decision skips redraw when the same PTY already has the same size", () => {
  assert.equal(
    typeof (ptyResize as Record<string, unknown>).getPtyResizeDecision,
    "function",
  );

  const getPtyResizeDecision = (
    ptyResize as {
      getPtyResizeDecision: (
        previous: { ptyId: number; cols: number; rows: number } | null,
        next: { ptyId: number; cols: number; rows: number },
      ) => { shouldResize: boolean };
    }
  ).getPtyResizeDecision;

  assert.deepEqual(
    getPtyResizeDecision(
      { ptyId: 7, cols: 120, rows: 40 },
      { ptyId: 7, cols: 120, rows: 40 },
    ),
    { shouldResize: false },
  );
});

test("pty resize decision forces a sync for a new PTY even if geometry matches", () => {
  const getPtyResizeDecision = (
    ptyResize as {
      getPtyResizeDecision: (
        previous: { ptyId: number; cols: number; rows: number } | null,
        next: { ptyId: number; cols: number; rows: number },
      ) => { shouldResize: boolean };
    }
  ).getPtyResizeDecision;

  assert.deepEqual(
    getPtyResizeDecision(
      { ptyId: 7, cols: 120, rows: 40 },
      { ptyId: 8, cols: 120, rows: 40 },
    ),
    { shouldResize: true },
  );
});

test("pty resize decision forces a sync when geometry changes", () => {
  const getPtyResizeDecision = (
    ptyResize as {
      getPtyResizeDecision: (
        previous: { ptyId: number; cols: number; rows: number } | null,
        next: { ptyId: number; cols: number; rows: number },
      ) => { shouldResize: boolean };
    }
  ).getPtyResizeDecision;

  assert.deepEqual(
    getPtyResizeDecision(
      { ptyId: 7, cols: 120, rows: 40 },
      { ptyId: 7, cols: 121, rows: 40 },
    ),
    { shouldResize: true },
  );
});
