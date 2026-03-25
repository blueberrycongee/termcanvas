import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateOnlyPrompt,
  dispatchCreateOnly,
} from "../src/dispatcher.ts";

test("buildCreateOnlyPrompt only references task and result paths", () => {
  const prompt = buildCreateOnlyPrompt(
    "/repo/.hydra/workflows/wf-1/handoff-1/task.md",
    "/repo/.hydra/workflows/wf-1/handoff-1/result.json",
  );

  assert.ok(!prompt.includes("\n"), "prompt must stay single-line");
  assert.match(prompt, /task\.md/);
  assert.match(prompt, /result\.json/);
  assert.doesNotMatch(prompt, /follow-up|input/i);
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
