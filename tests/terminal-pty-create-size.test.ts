import test from "node:test";
import assert from "node:assert/strict";

import { getInitialPtyCreateSize } from "../src/terminal/ptyCreateSize.ts";

test("getInitialPtyCreateSize fits the session before reading terminal geometry", () => {
  let fitCalls = 0;
  let cols = 80;
  let rows = 24;

  const size = getInitialPtyCreateSize(
    {
      fit: () => {
        fitCalls += 1;
        cols = 132;
        rows = 40;
      },
    },
    {
      get cols() {
        return cols;
      },
      get rows() {
        return rows;
      },
    },
  );

  assert.equal(fitCalls, 1);
  assert.deepEqual(size, { cols: 132, rows: 40 });
});

test("getInitialPtyCreateSize skips invalid terminal geometry", () => {
  assert.equal(
    getInitialPtyCreateSize(
      { fit: () => {} },
      { cols: 0, rows: 24 },
    ),
    null,
  );

  assert.equal(
    getInitialPtyCreateSize(
      { fit: () => {} },
      { cols: 80, rows: -1 },
    ),
    null,
  );
});
