import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateOnlyPrompt,
  dispatchCreateOnly,
} from "../src/dispatcher.ts";

test("buildCreateOnlyPrompt emits a result-only assignment/run contract", () => {
  const prompt = buildCreateOnlyPrompt(
    "/repo/.hydra/workflows/wf-1/assignments/asg-1/runs/run-1/task.md",
    "wf-1",
    "/repo/.hydra/workflows/wf-1/assignments/asg-1/runs/run-1/result.json",
    {
      assignmentId: "asg-1",
      runId: "run-1",
    },
  );

  assert.ok(!prompt.includes("\n"), "prompt must stay single-line");
  assert.match(prompt, /task\.md/);
  assert.match(prompt, /result\.json/);
  assert.match(prompt, /hydra\/result\/v1/);
  assert.match(prompt, /assignment_id=asg-1/);
  assert.match(prompt, /run_id=run-1/);
  assert.match(prompt, /atomically/i);
});

test("dispatchCreateOnly launches a terminal with the create-only prompt", async () => {
  const calls: Array<{ type: string; args: unknown[] }> = [];

  const result = await dispatchCreateOnly(
    {
      workflowId: "workflow-auth",
      assignmentId: "assignment-abc123",
      runId: "run-1",
      repoPath: "/repo/project",
      worktreePath: "/repo/project/.worktrees/hydra-1",
      agentType: "codex",
      taskFile: "/repo/project/.hydra/workflows/workflow-auth/assignments/assignment-abc123/runs/run-1/task.md",
      resultFile: "/repo/project/.hydra/workflows/workflow-auth/assignments/assignment-abc123/runs/run-1/result.json",
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

  const expectedPrompt = buildCreateOnlyPrompt(
    "/repo/project/.hydra/workflows/workflow-auth/assignments/assignment-abc123/runs/run-1/task.md",
    "workflow-auth",
    "/repo/project/.hydra/workflows/workflow-auth/assignments/assignment-abc123/runs/run-1/result.json",
    {
      assignmentId: "assignment-abc123",
      runId: "run-1",
    },
  );

  assert.deepEqual(result, {
    projectId: "project-1",
    terminalId: "terminal-1",
    terminalType: "codex",
    terminalTitle: "Codex",
    prompt: expectedPrompt,
  });
  assert.deepEqual(calls, [
    { type: "isTermCanvasRunning", args: [] },
    { type: "findProjectByPath", args: ["/repo/project"] },
    {
      type: "terminalCreate",
      args: [
        "/repo/project/.worktrees/hydra-1",
        "codex",
        expectedPrompt,
        true,
        "terminal-parent",
        "workflow-auth",
        "assignment-abc123",
        "/repo/project",
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
          assignmentId: "assignment-abc123",
          runId: "run-1",
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
          assignmentId: "assignment-abc123",
          runId: "run-1",
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
