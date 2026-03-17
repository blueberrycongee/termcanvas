import test from "node:test";
import assert from "node:assert/strict";

import { HYDRA_SYSTEM_PROMPT, buildSpawnPrompt } from "../src/prompt.ts";

test("HYDRA_SYSTEM_PROMPT documents the core hydra workflow", () => {
  assert.match(HYDRA_SYSTEM_PROMPT, /hydra spawn --task/);
  assert.match(HYDRA_SYSTEM_PROMPT, /termcanvas terminal status/);
  assert.match(HYDRA_SYSTEM_PROMPT, /termcanvas diff/);
  assert.match(HYDRA_SYSTEM_PROMPT, /hydra cleanup/);
});

test("buildSpawnPrompt includes task and worktree context", () => {
  const prompt = buildSpawnPrompt({
    task: "list files",
    agentId: "hydra-1234",
    worktreePath: "/repo/.worktrees/hydra-1234",
    branch: "hydra/hydra-1234",
    baseBranch: "main",
  });

  assert.match(prompt, /list files/);
  assert.match(prompt, /hydra-1234/);
  assert.match(prompt, /\/repo\/\.worktrees\/hydra-1234/);
  assert.match(prompt, /hydra\/hydra-1234/);
  assert.match(prompt, /main/);
});
