import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateOnlyPrompt,
  dispatchCreateOnly,
} from "../src/dispatcher.ts";

test("buildCreateOnlyPrompt spells out the done marker JSON contract", () => {
  const prompt = buildCreateOnlyPrompt(
    "/repo/.hydra/workflows/wf-1/handoff-1/task.md",
    "/repo/.hydra/workflows/wf-1/handoff-1/done",
    "handoff-1",
    "wf-1",
    "/repo/.hydra/workflows/wf-1/handoff-1/result.json",
  );

  assert.ok(!prompt.includes("\n"), "prompt must stay single-line");
  assert.match(prompt, /task\.md/);
  assert.match(prompt, /result\.json/);
  assert.match(prompt, /done/i);
  assert.match(prompt, /JSON done marker/i);
  assert.match(prompt, /handoff_id=handoff-1/);
  assert.match(prompt, /workflow_id=wf-1/);
  assert.match(prompt, /result_file=/);
});

test("dispatchCreateOnly launches a terminal with the create-only prompt", async () => {
  const calls: Array<{ type: string; args: unknown[] }> = [];

  const result = await dispatchCreateOnly(
    {
      workflowId: "workflow-auth",
      handoffId: "handoff-abc123",
      repoPath: "/repo/project",
      worktreePath: "/repo/project/.worktrees/hydra-1",
      agentType: "codex",
      taskFile: "/repo/project/.hydra/workflows/workflow-auth/handoff-abc123/task.md",
      doneFile: "/repo/project/.hydra/workflows/workflow-auth/handoff-abc123/done",
      resultFile: "/repo/project/.hydra/workflows/workflow-auth/handoff-abc123/result.json",
      autoApprove: true,
      parentTerminalId: "terminal-parent",
    },
    {
      isTermCanvasRunning() {
        calls.push({ type: "isTermCanvasRunning", args: [] });
        return true;
      },
      findProjectByPath(repoPath) {
        calls.push({ type: "findProjectByPath", args: [repoPath] });
        return { id: "project-1", path: repoPath };
      },
      terminalCreate(...args) {
        calls.push({ type: "terminalCreate", args });
        return { id: "terminal-1", type: "codex", title: "Codex" };
      },
    },
  );

  assert.deepEqual(result, {
    projectId: "project-1",
    terminalId: "terminal-1",
    terminalType: "codex",
    terminalTitle: "Codex",
    prompt: buildCreateOnlyPrompt(
      "/repo/project/.hydra/workflows/workflow-auth/handoff-abc123/task.md",
      "/repo/project/.hydra/workflows/workflow-auth/handoff-abc123/done",
      "handoff-abc123",
      "workflow-auth",
      "/repo/project/.hydra/workflows/workflow-auth/handoff-abc123/result.json",
    ),
  });
  assert.deepEqual(calls, [
    { type: "isTermCanvasRunning", args: [] },
    { type: "findProjectByPath", args: ["/repo/project"] },
    {
      type: "terminalCreate",
      args: [
        "/repo/project/.worktrees/hydra-1",
        "codex",
        buildCreateOnlyPrompt(
          "/repo/project/.hydra/workflows/workflow-auth/handoff-abc123/task.md",
          "/repo/project/.hydra/workflows/workflow-auth/handoff-abc123/done",
          "handoff-abc123",
          "workflow-auth",
          "/repo/project/.hydra/workflows/workflow-auth/handoff-abc123/result.json",
        ),
        true,
        "terminal-parent",
      ],
    },
  ]);
});

test("dispatchCreateOnly fails when TermCanvas is not running", async () => {
  await assert.rejects(
    () =>
      dispatchCreateOnly(
        {
          workflowId: "workflow-auth",
          handoffId: "handoff-abc123",
          repoPath: "/repo/project",
          worktreePath: "/repo/project/.worktrees/hydra-1",
          agentType: "claude",
          taskFile: "/repo/project/task.md",
          doneFile: "/repo/project/done",
          resultFile: "/repo/project/result.json",
        },
        {
          isTermCanvasRunning: () => false,
          findProjectByPath: () => {
            throw new Error("must not be called");
          },
          terminalCreate: () => {
            throw new Error("must not be called");
          },
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "DISPATCH_TERMCANVAS_NOT_RUNNING");
      return true;
    },
  );
});

test("dispatchCreateOnly fails when the repo is not on the canvas", async () => {
  await assert.rejects(
    () =>
      dispatchCreateOnly(
        {
          workflowId: "workflow-auth",
          handoffId: "handoff-abc123",
          repoPath: "/repo/project",
          worktreePath: "/repo/project/.worktrees/hydra-1",
          agentType: "claude",
          taskFile: "/repo/project/task.md",
          doneFile: "/repo/project/done",
          resultFile: "/repo/project/result.json",
        },
        {
          isTermCanvasRunning: () => true,
          findProjectByPath: () => null,
          terminalCreate: () => {
            throw new Error("must not be called");
          },
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { errorCode?: string }).errorCode, "DISPATCH_REPO_NOT_ON_CANVAS");
      return true;
    },
  );
});
