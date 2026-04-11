import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess, spawn as NodeSpawn } from "node:child_process";
import { TelemetryService } from "../electron/telemetry-service.ts";
import { ServerEventBus } from "../headless-runtime/event-bus.ts";
import { ProjectStore } from "../headless-runtime/project-store.ts";
import {
  _activeSubprocessCount,
  destroySubprocessWorker,
  launchSubprocessWorker,
} from "../headless-runtime/subprocess-worker.ts";
import {
  addProjectWithMainWorktree,
  createWorkspaceFixture,
} from "./headless-runtime-test-helpers.ts";

/**
 * Minimal ChildProcess stand-in. Real ChildProcess has ~50 fields we don't
 * need; subprocess-worker.ts only touches .stdout/.stderr/.on/.kill, and
 * only reads stdout as utf8 via setEncoding+'data' events. A plain
 * EventEmitter satisfies those contract points.
 */
class FakeStream extends EventEmitter {
  setEncoding(_encoding: BufferEncoding): this {
    return this;
  }
}

class FakeChildProcess extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed = false;
  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    return true;
  }
  /** Test helper: push a chunk onto stdout. */
  emitStdout(chunk: string): void {
    this.stdout.emit("data", chunk);
  }
  /** Test helper: simulate process exit with given code. */
  emitExit(code: number | null): void {
    this.emit("exit", code);
  }
}

interface SpawnCall {
  shell: string;
  args: string[];
  cwd: string | undefined;
}

function makeSpawnImpl(): {
  spawnImpl: typeof NodeSpawn;
  calls: SpawnCall[];
  lastChild: () => FakeChildProcess | null;
} {
  const calls: SpawnCall[] = [];
  let current: FakeChildProcess | null = null;
  const impl = ((shell: string, args: string[], opts: { cwd?: string }) => {
    calls.push({ shell, args, cwd: opts?.cwd });
    current = new FakeChildProcess();
    return current as unknown as ChildProcess;
  }) as unknown as typeof NodeSpawn;
  return { spawnImpl: impl, calls, lastChild: () => current };
}

test("subprocess-worker: claude launch builds -p --output-format json argv and tracks lifecycle", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "subprocess-claude");
  const telemetryService = new TelemetryService({
    processPollIntervalMs: 0,
    sessionPollIntervalMs: 0,
  });
  const eventBus = new ServerEventBus();
  const { spawnImpl, calls, lastChild } = makeSpawnImpl();

  try {
    const result = await launchSubprocessWorker({
      projectStore,
      telemetryService,
      eventBus,
      worktree: workspaceDir,
      type: "claude",
      prompt: "read task.md and follow it",
      autoApprove: true,
      model: "claude-opus-4-6",
      reasoningEffort: "max",
      workflowId: "wf-test",
      assignmentId: "asg-test",
      spawnImpl,
    });

    // Shell + argv shape matches the claude -p non-interactive contract.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].shell, "claude");
    const args = calls[0].args;
    assert.deepEqual(args.slice(0, 3), ["-p", "--output-format", "json"]);
    assert.ok(args.includes("--dangerously-skip-permissions"));
    assert.ok(args.includes("--model"));
    assert.equal(args[args.indexOf("--model") + 1], "claude-opus-4-6");
    assert.ok(args.includes("--effort"));
    assert.equal(args[args.indexOf("--effort") + 1], "max");
    // Last arg is always the prompt positional.
    assert.equal(args[args.length - 1], "read task.md and follow it");
    // cwd for execFile is the worktree.
    assert.equal(calls[0].cwd, workspaceDir);

    // A terminal was added to projectStore and its status is "running".
    const terminal = projectStore.getTerminal(result.id);
    assert.ok(terminal, "terminal should be added to projectStore");
    assert.equal(terminal!.type, "claude");
    assert.equal(terminal!.status, "running");
    assert.equal(terminal!.ptyId, null, "subprocess workers have ptyId=null");

    // Active subprocess registry tracks the child.
    assert.equal(_activeSubprocessCount(), 1);

    // Simulate claude's structured json output envelope + clean exit.
    const child = lastChild();
    assert.ok(child);
    child!.emitStdout(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "abcd-1234-efgh-5678",
        result: "done",
        num_turns: 5,
        stop_reason: "end_turn",
      }),
    );
    child!.emitExit(0);

    // Post-exit: terminal should be "success", subprocess deregistered.
    const post = projectStore.getTerminal(result.id);
    assert.equal(post!.status, "success");
    assert.equal(_activeSubprocessCount(), 0);

    // session_id should have been forwarded to telemetry.
    const snap = telemetryService.getTerminalSnapshot(result.id);
    assert.ok(snap);
    assert.equal(snap!.session_attached, true);
    assert.equal(snap!.session_id, "abcd-1234-efgh-5678");
    assert.equal(snap!.provider, "claude");
  } finally {
    telemetryService.dispose();
  }
});

test("subprocess-worker: codex launch builds `exec --json --cd --skip-git-repo-check` argv with thread_id extraction", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "subprocess-codex");
  const telemetryService = new TelemetryService({
    processPollIntervalMs: 0,
    sessionPollIntervalMs: 0,
  });
  const eventBus = new ServerEventBus();
  const { spawnImpl, calls, lastChild } = makeSpawnImpl();

  try {
    const result = await launchSubprocessWorker({
      projectStore,
      telemetryService,
      eventBus,
      worktree: workspaceDir,
      type: "codex",
      prompt: "read task.md and follow it",
      autoApprove: true,
      model: "gpt-5.4",
      reasoningEffort: "high",
      workflowId: "wf-codex",
      assignmentId: "asg-codex",
      spawnImpl,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].shell, "codex");
    const args = calls[0].args;
    // First arg is the `exec` subcommand, not a flag.
    assert.equal(args[0], "exec");
    // --skip-git-repo-check is required for non-git cwds, --cd sets the agent root.
    assert.ok(args.includes("--skip-git-repo-check"));
    assert.ok(args.includes("--cd"));
    assert.equal(args[args.indexOf("--cd") + 1], workspaceDir);
    assert.ok(args.includes("--json"));
    assert.ok(args.includes("--dangerously-bypass-approvals-and-sandbox"));
    assert.ok(args.includes("-m"));
    assert.equal(args[args.indexOf("-m") + 1], "gpt-5.4");
    assert.ok(args.includes("-c"));
    assert.equal(
      args[args.indexOf("-c") + 1],
      "model_reasoning_effort=high",
    );
    assert.equal(args[args.length - 1], "read task.md and follow it");

    // Simulate codex JSONL stream: thread.started carries thread_id, then a
    // turn.completed, then clean exit.
    const child = lastChild();
    assert.ok(child);
    child!.emitStdout(
      `${JSON.stringify({ type: "thread.started", thread_id: "codex-thread-9999" })}\n`,
    );
    child!.emitStdout(
      `${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } })}\n`,
    );
    child!.emitExit(0);

    const post = projectStore.getTerminal(result.id);
    assert.equal(post!.status, "success");

    const snap = telemetryService.getTerminalSnapshot(result.id);
    assert.equal(snap!.session_id, "codex-thread-9999");
    assert.equal(snap!.provider, "codex");
  } finally {
    telemetryService.dispose();
  }
});

test("subprocess-worker: claude resume path adds --resume + --fork-session", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "subprocess-resume");
  const telemetryService = new TelemetryService({
    processPollIntervalMs: 0,
    sessionPollIntervalMs: 0,
  });
  const { spawnImpl, calls, lastChild } = makeSpawnImpl();

  try {
    await launchSubprocessWorker({
      projectStore,
      telemetryService,
      worktree: workspaceDir,
      type: "claude",
      prompt: "follow up question",
      autoApprove: true,
      resumeSessionId: "prior-session-id-1234",
      spawnImpl,
    });

    const args = calls[0].args;
    assert.ok(args.includes("--resume"));
    assert.equal(args[args.indexOf("--resume") + 1], "prior-session-id-1234");
    assert.ok(
      args.includes("--fork-session"),
      "claude follow-ups must fork to preserve the original session",
    );

    // Clean up without asserting on outcome — this test only covers argv.
    lastChild()!.emitExit(0);
  } finally {
    telemetryService.dispose();
  }
});

test("subprocess-worker: non-zero exit marks terminal as error", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "subprocess-error");
  const telemetryService = new TelemetryService({
    processPollIntervalMs: 0,
    sessionPollIntervalMs: 0,
  });
  const { spawnImpl, lastChild } = makeSpawnImpl();

  try {
    const result = await launchSubprocessWorker({
      projectStore,
      telemetryService,
      worktree: workspaceDir,
      type: "claude",
      prompt: "this will fail",
      autoApprove: true,
      spawnImpl,
    });

    // Simulate failure: no stdout, exit code 2.
    lastChild()!.emitExit(2);

    const post = projectStore.getTerminal(result.id);
    assert.equal(post!.status, "error");
    assert.equal(_activeSubprocessCount(), 0);
  } finally {
    telemetryService.dispose();
  }
});

test("subprocess-worker: destroySubprocessWorker kills active child; no-op otherwise", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "subprocess-destroy");
  const telemetryService = new TelemetryService({
    processPollIntervalMs: 0,
    sessionPollIntervalMs: 0,
  });
  const { spawnImpl, lastChild } = makeSpawnImpl();

  try {
    const result = await launchSubprocessWorker({
      projectStore,
      telemetryService,
      worktree: workspaceDir,
      type: "claude",
      prompt: "running",
      autoApprove: true,
      spawnImpl,
    });

    assert.equal(_activeSubprocessCount(), 1);
    const killed = destroySubprocessWorker(result.id);
    assert.equal(killed, true);
    assert.equal(lastChild()!.killed, true);
    assert.equal(_activeSubprocessCount(), 0);

    // No-op for unknown id.
    const killedAgain = destroySubprocessWorker(result.id);
    assert.equal(killedAgain, false);

    // No-op for id from a different (non-subprocess) source.
    assert.equal(destroySubprocessWorker("not-a-real-id"), false);
  } finally {
    telemetryService.dispose();
  }
});

test("subprocess-worker: rejects unsupported cli type", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "subprocess-reject");
  const telemetryService = new TelemetryService({
    processPollIntervalMs: 0,
    sessionPollIntervalMs: 0,
  });
  const { spawnImpl } = makeSpawnImpl();

  try {
    await assert.rejects(
      () =>
        launchSubprocessWorker({
          projectStore,
          telemetryService,
          worktree: workspaceDir,
          type: "shell",
          prompt: "nope",
          spawnImpl,
        }),
      /supports only claude\|codex/,
    );
  } finally {
    telemetryService.dispose();
  }
});
