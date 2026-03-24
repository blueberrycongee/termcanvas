import test from "node:test";
import assert from "node:assert/strict";

import { syncTerminalCursorBlink } from "../src/terminal/cursorBlink.ts";

test("syncTerminalCursorBlink updates the terminal option and forces a redraw", () => {
  const renderCalls: Array<{ forceAll: boolean; viewportY: number }> = [];
  const terminal = {
    options: {
      cursorBlink: false,
    },
    renderer: {
      render: (_buffer: unknown, forceAll: boolean, viewportY: number) => {
        renderCalls.push({ forceAll, viewportY });
      },
    },
    wasmTerm: { kind: "wasm" },
    getViewportY: () => 3,
  };

  syncTerminalCursorBlink(terminal, true);

  assert.equal(terminal.options.cursorBlink, true);
  assert.deepEqual(renderCalls, [{ forceAll: true, viewportY: 3 }]);
});

test("syncTerminalCursorBlink is a no-op when the requested state already matches", () => {
  let renderCalls = 0;
  const terminal = {
    options: {
      cursorBlink: true,
    },
    renderer: {
      render: () => {
        renderCalls += 1;
      },
    },
    wasmTerm: { kind: "wasm" },
    getViewportY: () => 0,
  };

  syncTerminalCursorBlink(terminal, true);

  assert.equal(renderCalls, 0);
});
