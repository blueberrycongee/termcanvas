import test from "node:test";
import assert from "node:assert/strict";

import { buildTerminalSessionBootstrapConfig } from "../src/terminal/sessionBootstrap.ts";

test("terminal session bootstrap config stays stable across focus changes", () => {
  const baseInput = {
    theme: {
      background: "#111111",
      foreground: "#eeeeee",
    },
    fontFamily: '"Geist Mono", monospace',
    fontSize: 14,
    minimumContrastRatio: 4.5,
    scrollback: "hello\r\n",
  };

  const unfocused = buildTerminalSessionBootstrapConfig({
    ...baseInput,
    focused: false,
  });
  const focused = buildTerminalSessionBootstrapConfig({
    ...baseInput,
    focused: true,
  });

  assert.deepEqual(focused, unfocused);
  assert.equal(focused.cursorBlink, false);
  assert.equal(focused.scrollback, "hello\r\n");
});
