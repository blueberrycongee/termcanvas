import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess, spawn as NodeSpawn } from "node:child_process";
import { askFollowUp } from "../src/ask.ts";

// Minimal ChildProcess stand-in. Ask only touches stdout/stderr/on/kill.
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
  emitStdout(chunk: string): void {
    this.stdout.emit("data", chunk);
  }
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

test("askFollowUp (claude) builds the --resume --fork-session argv and parses the result envelope", async () => {
  const { spawnImpl, calls, lastChild } = makeSpawnImpl();
  const promise = askFollowUp({
    cli: "claude",
    sessionId: "original-session-abc",
    message: "why did you choose pattern A?",
    workdir: "/tmp/workdir",
    spawnImpl,
  });
  // Feed a claude-shaped result envelope then exit.
  await new Promise((r) => setImmediate(r));
  const child = lastChild()!;
  child.emitStdout(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: "forked-session-xyz",
      result: "Because pattern A is thread-safe.",
      num_turns: 1,
    }),
  );
  child.emitExit(0);
  const result = await promise;

  // argv shape
  assert.equal(calls.length, 1);
  assert.equal(calls[0].shell, "claude");
  assert.deepEqual(calls[0].args.slice(0, 3), ["-p", "--output-format", "json"]);
  assert.ok(calls[0].args.includes("--dangerously-skip-permissions"));
  assert.ok(calls[0].args.includes("--resume"));
  assert.equal(calls[0].args[calls[0].args.indexOf("--resume") + 1], "original-session-abc");
  assert.ok(
    calls[0].args.includes("--fork-session"),
    "follow-up must fork so the original session stays pristine",
  );
  // Last arg is the message.
  assert.equal(calls[0].args[calls[0].args.length - 1], "why did you choose pattern A?");

  // Parsed output
  assert.equal(result.answer, "Because pattern A is thread-safe.");
  assert.equal(result.newSessionId, "forked-session-xyz");
  assert.equal(result.exitCode, 0);
  assert.ok(result.durationMs >= 0);
});

test("askFollowUp (codex) builds `exec resume <id>` subcommand and parses item.completed agent_message events", async () => {
  const { spawnImpl, calls, lastChild } = makeSpawnImpl();
  const promise = askFollowUp({
    cli: "codex",
    sessionId: "codex-thread-999",
    message: "what exact files did you touch?",
    workdir: "/tmp/workdir",
    spawnImpl,
  });
  await new Promise((r) => setImmediate(r));
  const child = lastChild()!;
  // Simulate codex JSONL stream: thread.started, a reasoning item we must
  // ignore, an agent_message item that contains the real answer, and exit.
  child.emitStdout(
    `${JSON.stringify({ type: "thread.started", thread_id: "codex-thread-999" })}\n`,
  );
  child.emitStdout(
    `${JSON.stringify({
      type: "item.completed",
      item: { id: "r1", type: "reasoning", text: "internal thinking we should not surface" },
    })}\n`,
  );
  child.emitStdout(
    `${JSON.stringify({
      type: "item.completed",
      item: { id: "m1", type: "agent_message", text: "I touched src/auth.ts and tests/auth.test.ts." },
    })}\n`,
  );
  child.emitExit(0);
  const result = await promise;

  // argv shape: `codex exec resume <sid> --dangerously-bypass... --skip-git-repo-check --cd <workdir> --json <msg>`
  assert.equal(calls[0].shell, "codex");
  assert.deepEqual(calls[0].args.slice(0, 3), ["exec", "resume", "codex-thread-999"]);
  assert.ok(calls[0].args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(calls[0].args.includes("--skip-git-repo-check"));
  assert.ok(calls[0].args.includes("--cd"));
  assert.equal(calls[0].args[calls[0].args.indexOf("--cd") + 1], "/tmp/workdir");
  assert.ok(calls[0].args.includes("--json"));
  assert.equal(calls[0].args[calls[0].args.length - 1], "what exact files did you touch?");

  // Answer must come only from agent_message items, not reasoning items.
  assert.equal(result.answer, "I touched src/auth.ts and tests/auth.test.ts.");
  assert.ok(
    !result.answer.includes("internal thinking"),
    "reasoning items must be filtered out of the user-facing answer",
  );
  // codex has no fork — newSessionId equals the original.
  assert.equal(result.newSessionId, "codex-thread-999");
});

test("askFollowUp rejects unsupported cli types", async () => {
  await assert.rejects(
    () =>
      askFollowUp({
        cli: "kimi" as unknown as "claude",
        sessionId: "sid",
        message: "hi",
        workdir: "/tmp",
      }),
    /supports only claude\|codex/,
  );
});

test("askFollowUp times out and kills the child when the subprocess wedges", async () => {
  const { spawnImpl, lastChild } = makeSpawnImpl();
  const promise = askFollowUp({
    cli: "claude",
    sessionId: "sid",
    message: "hi",
    workdir: "/tmp",
    timeoutMs: 20,
    spawnImpl,
  });
  // Never emit exit — should time out.
  await assert.rejects(promise, /timed out/);
  assert.equal(lastChild()!.killed, true);
});
