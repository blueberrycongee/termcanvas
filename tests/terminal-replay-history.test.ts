import test from "node:test";
import assert from "node:assert/strict";

import { createTerminalReplayHistory } from "../src/terminal/replayHistory.ts";

test("replay history preserves ANSI-colored output for terminal rebuilds", () => {
  const history = createTerminalReplayHistory("restored prompt\r\n");

  history.append("\x1b[31merror\x1b[0m");
  history.append("\r\n$ ");

  assert.equal(
    history.getContent(),
    "restored prompt\r\n\x1b[31merror\x1b[0m\r\n$ ",
  );
});

test("replay history drops the oldest chunks when the cap is exceeded", () => {
  const history = createTerminalReplayHistory("", 8);

  history.append("aa");
  history.append("bb");
  history.append("cc");
  history.append("dd");
  history.append("ee");

  assert.equal(history.getContent(), "bbccddee");
});
