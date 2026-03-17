import test from "node:test";
import assert from "node:assert/strict";

import { getTerminalLaunchOptions } from "../src/terminal/cliConfig.ts";
import { HYDRA_SYSTEM_PROMPT } from "../hydra/src/prompt.ts";

test("new Claude terminals append the hydra system prompt when hydra is available", () => {
  const launch = getTerminalLaunchOptions("claude", undefined, true);

  assert.deepEqual(launch, {
    shell: "claude",
    args: ["--append-system-prompt", HYDRA_SYSTEM_PROMPT],
  });
});

test("Claude resume keeps the existing resume flow even when hydra is available", () => {
  const launch = getTerminalLaunchOptions("claude", "session-123", true);

  assert.deepEqual(launch, {
    shell: "claude",
    args: ["--resume", "session-123"],
  });
});

test("non-Claude terminals do not receive hydra prompt injection", () => {
  const launch = getTerminalLaunchOptions("codex", undefined, true);

  assert.deepEqual(launch, {
    shell: "codex",
    args: [],
  });
});
