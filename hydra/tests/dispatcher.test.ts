import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateOnlyPrompt,
  dispatchCreateOnly,
} from "../src/dispatcher.ts";

test("buildCreateOnlyPrompt commands the agent to read task.md first", () => {
  const prompt = buildCreateOnlyPrompt(
    "/repo/.hydra/workflows/wf-1/assignments/asg-1/runs/run-1/task.md",
    "wf-1",
    "/repo/.hydra/workflows/wf-1/assignments/asg-1/runs/run-1/result.json",
    {
      assignmentId: "asg-1",
      runId: "run-1",
    },
  );

  // Prompt is intentionally slim — task.md is the single source of truth for
  // the schema, output paths, etc. The prompt's only job is to mandate the
  // read-first ordering so the agent can't skip the contract.
  assert.ok(!prompt.includes("\n"), "prompt must stay single-line");
  assert.match(prompt, /task\.md/, "prompt must reference the task file path");
  assert.match(prompt, /MUST/, "prompt must use imperative MUST");
  assert.match(prompt, /FIRST/, "prompt must assert read-first ordering");
});

test("dispatchCreateOnly launches a terminal with the create-only prompt", async () => {
  const calls: Array<{ type: string; args: unknown[] }> = [];

  const result = await dispatchCreateOnly(
    {
      workbenchId: "workflow-auth",
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
        undefined,
      ],
    },
  ]);
});

test("dispatchCreateOnly forwards resumeSessionId to terminalCreate", async () => {
  const calls: Array<{ type: string; args: unknown[] }> = [];

  await dispatchCreateOnly(
    {
      workbenchId: "workflow-resume",
      assignmentId: "assignment-resume",
      runId: "run-2",
      repoPath: "/repo/project",
      worktreePath: "/repo/project",
      agentType: "claude",
      taskFile: "/repo/project/task.md",
      resultFile: "/repo/project/result.json",
      autoApprove: false,
      resumeSessionId: "claude-session-xyz",
    },
    {
      isTermCanvasRunning: () => true,
      findProjectByPath: (repoPath) => ({ id: "project-1", path: repoPath }),
      terminalCreate: (...args) => {
        calls.push({ type: "terminalCreate", args });
        return { id: "terminal-2", type: "claude", title: "Claude" };
      },
    },
  );

  const terminalCall = calls.find((c) => c.type === "terminalCreate");
  assert.ok(terminalCall);
  // resumeSessionId is the 9th positional argument
  assert.equal(terminalCall.args[8], "claude-session-xyz");
});

test("dispatchCreateOnly fails when the runtime is not available", async () => {
  await assert.rejects(
    () =>
      dispatchCreateOnly(
        {
          workbenchId: "workflow-auth",
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
      assert.equal((error as Error & { errorCode?: string }).errorCode, "DISPATCH_RUNTIME_UNAVAILABLE");
      return true;
    },
  );
});

test("dispatchCreateOnly fails when the repo is not tracked by the runtime", async () => {
  await assert.rejects(
    () =>
      dispatchCreateOnly(
        {
          workbenchId: "workflow-auth",
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
      assert.equal((error as Error & { errorCode?: string }).errorCode, "DISPATCH_REPO_NOT_TRACKED");
      return true;
    },
  );
});
