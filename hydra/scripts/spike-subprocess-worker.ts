#!/usr/bin/env -S node --experimental-strip-types

/**
 * Spike: prove that a Hydra worker can be dispatched as a plain subprocess
 * (claude -p / codex exec) instead of a termcanvas PTY-attached terminal —
 * WITHOUT changing any Lead-facing API or worker deliverable contract.
 *
 * What stays the same (invariant):
 *   - Lead API:      hydra dispatch/watch/reset/approve/merge/complete
 *   - Worker input:  task.md (read from cwd)
 *   - Worker output: hello.txt (task artifact) + report.md + result.json
 *   - result.json schema:  hydra/result/v0.1
 *   - Role registry, ledger, retry policy, state machine — untouched
 *
 * What the spike proves:
 *   Phase 1 — dispatch:
 *     (a) claude -p / codex exec can run a worker autonomously with tools
 *     (b) cwd-based task.md delivery works the same as PTY mode
 *     (c) worker writes the three deliverable files before exiting
 *     (d) session_id is emitted by the CLI in structured stdout
 *         (claude: --output-format json result envelope;
 *          codex:  --json event stream, thread.started event)
 *
 *   Phase 2 — follow-up via resume:
 *     (e) a fresh subprocess with --resume <sid> reloads prior conversation
 *     (f) the resume invocation accepts a new prompt in the same call
 *     (g) the worker correctly recalls what it did in Phase 1 (proves the
 *         session was truly restored, not hallucinated)
 *
 * If both phases pass on both CLIs, the migration in workflow-control.ts
 * amounts to swapping one call (`launchTrackedTerminal` → a new
 * `launchSubprocessWorker`) while everything else stays put.
 *
 * Usage:
 *   node --experimental-strip-types hydra/scripts/spike-subprocess-worker.ts --cli claude
 *   node --experimental-strip-types hydra/scripts/spike-subprocess-worker.ts --cli codex
 *   node --experimental-strip-types hydra/scripts/spike-subprocess-worker.ts --cli both
 *
 * This script is fully standalone. It does NOT import from hydra/src.
 * If it works, any subprocess spawner anywhere can drive a Hydra worker.
 *
 * Cost warning: each phase on each CLI makes real API calls. Expect
 * ~$0.05-$0.30 total for a full --cli both run.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

type Cli = "claude" | "codex";

interface PhaseResult {
  ok: boolean;
  sessionId: string | null;
  durationMs: number;
  notes: string[];
  failure?: string;
}

const HELLO_CONTENT = "hi from subprocess worker";

const TASK_MD = `# Spike Task

You are a worker running under a Hydra subprocess spike. Produce three
files in your current working directory, then end your turn.

## Required files

1. \`hello.txt\` — exactly these contents, one line, no quotes, no trailing prose:
${HELLO_CONTENT}

2. \`report.md\` — one or two sentences stating what you wrote.

3. \`result.json\` — exactly this JSON, no extra keys:

    {
      "schema_version": "hydra/result/v0.1",
      "workflow_id": "spike",
      "assignment_id": "spike-a",
      "run_id": "spike-r",
      "outcome": "completed",
      "report_file": "report.md"
    }

## Rules

- Use your Write tool for all three files.
- The task is fully specified. Do not ask clarifying questions.
- After the three files exist, end your turn immediately. No extra output.
`;

function parseArgs(): { cli: Cli | "both" } {
  const argv = process.argv.slice(2);
  let cli: Cli | "both" | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cli" && i + 1 < argv.length) {
      const next = argv[++i];
      if (next !== "claude" && next !== "codex" && next !== "both") {
        throw new Error(`--cli must be claude | codex | both (got ${next})`);
      }
      cli = next;
    }
  }
  if (!cli) {
    throw new Error("--cli is required (claude | codex | both) — this script makes real API calls");
  }
  return { cli };
}

function makeWorkdir(cli: Cli): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hydra-spike-${cli}-`));
  fs.writeFileSync(path.join(dir, "task.md"), TASK_MD, "utf8");
  return dir;
}

async function which(bin: string): Promise<boolean> {
  try {
    await execFileAsync("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

// -------- claude path --------

async function runClaudeDispatch(workdir: string): Promise<PhaseResult> {
  const start = Date.now();
  const args = [
    "-p",
    "--output-format", "json",
    "--dangerously-skip-permissions",
    "--model", "claude-opus-4-6",
    "Read ./task.md in this directory and follow it exactly.",
  ];
  let stdout: string;
  try {
    const res = await execFileAsync("claude", args, {
      cwd: workdir,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (err) {
    return {
      ok: false,
      sessionId: null,
      durationMs: Date.now() - start,
      notes: [],
      failure: `claude dispatch failed: ${(err as Error).message}`,
    };
  }
  const durationMs = Date.now() - start;
  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    return {
      ok: false,
      sessionId: null,
      durationMs,
      notes: [`stdout head: ${stdout.slice(0, 300)}`],
      failure: `claude stdout not valid JSON: ${(e as Error).message}`,
    };
  }
  return {
    ok: parsed.is_error === false,
    sessionId: parsed.session_id ?? null,
    durationMs,
    notes: [
      `session_id    = ${parsed.session_id}`,
      `num_turns     = ${parsed.num_turns}`,
      `stop_reason   = ${parsed.stop_reason}`,
      `cost_usd      = ${parsed.total_cost_usd}`,
      `api_ms        = ${parsed.duration_api_ms}`,
    ],
    failure: parsed.is_error ? `claude returned is_error=true: ${parsed.result}` : undefined,
  };
}

async function runClaudeFollowUp(sessionId: string, workdir: string): Promise<PhaseResult> {
  const start = Date.now();
  const args = [
    "-p",
    "--output-format", "json",
    "--dangerously-skip-permissions",
    "--resume", sessionId,
    "--fork-session",
    "What exact content did you write to hello.txt? Reply with only that content, no other words.",
  ];
  let stdout: string;
  try {
    const res = await execFileAsync("claude", args, {
      cwd: workdir,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (err) {
    return {
      ok: false,
      sessionId: null,
      durationMs: Date.now() - start,
      notes: [],
      failure: `claude follow-up failed: ${(err as Error).message}`,
    };
  }
  const durationMs = Date.now() - start;
  const parsed = JSON.parse(stdout);
  const answer: string = parsed.result ?? "";
  const newSessionId = parsed.session_id ?? null;
  const recalled = answer.toLowerCase().includes(HELLO_CONTENT.toLowerCase());
  return {
    ok: recalled,
    sessionId: newSessionId,
    durationMs,
    notes: [
      `answer          = ${JSON.stringify(answer.trim())}`,
      `forked session  = ${newSessionId}`,
      `original id     = ${sessionId}`,
      `recalled        = ${recalled}`,
    ],
    failure: recalled ? undefined : `answer did not contain "${HELLO_CONTENT}"`,
  };
}

// -------- codex path --------

// Field names and CLI flags verified against the codex source tree:
//   codex-rs/exec/src/cli.rs         — exec Cli + ResumeArgs subcommand
//   codex-rs/exec/src/exec_events.rs — ThreadEvent / ThreadItem wire schema
//   codex-rs/exec/src/event_processor_with_jsonl_output.rs — println! JSONL output
// Notes from the source read:
//   • --cd/-C sets the agent's workspace root, distinct from the process cwd
//   • --skip-git-repo-check is REQUIRED when workdir is not a git repo
//     (default codex refuses to run outside a git tree)
//   • `codex exec -p ...` would mean --profile, NOT print mode — we never
//     pass -p to avoid confusion with claude's -p
//   • thread.started.thread_id IS the session id (exec_events.rs: line 394
//     thread_id: session_configured.session_id.to_string())
//   • The final assistant text lives in item.completed events where the
//     flattened item has type === "agent_message" (AgentMessageItem.text)
//   • Reasoning summaries live in item.completed with type === "reasoning"
//     (ReasoningItem.text) — we must filter these OUT of the final answer
//   • turn.failed.error.message is the failure path (not e.message)

async function runCodexDispatch(workdir: string): Promise<PhaseResult> {
  const start = Date.now();
  const args = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--cd", workdir,
    "--json",
    "-m", "gpt-5.4",
    "-c", "model_reasoning_effort=high",
    "Read ./task.md in this directory and follow it exactly.",
  ];
  let stdout: string;
  let stderr: string;
  try {
    const res = await execFileAsync("codex", args, {
      cwd: workdir,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = res.stdout;
    stderr = res.stderr;
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string };
    return {
      ok: false,
      sessionId: null,
      durationMs: Date.now() - start,
      notes: [
        `stderr head: ${(e.stderr ?? "").slice(0, 300)}`,
      ],
      failure: `codex dispatch failed: ${e.message}`,
    };
  }
  const durationMs = Date.now() - start;
  const events = parseJsonl(stdout);
  const threadEvent = events.find((e) => e?.type === "thread.started");
  const sessionId = threadEvent?.thread_id ?? null;
  const failed = events.find((e) => e?.type === "turn.failed" || e?.type === "error");
  const turnCompleted = events.find((e) => e?.type === "turn.completed");
  const usage = turnCompleted?.usage ?? {};
  return {
    ok: !failed,
    sessionId,
    durationMs,
    notes: [
      `session_id    = ${sessionId}`,
      `event count   = ${events.length}`,
      `usage         = in=${usage.input_tokens ?? "?"} cached=${usage.cached_input_tokens ?? "?"} out=${usage.output_tokens ?? "?"}`,
      `stderr_len    = ${stderr.length}`,
    ],
    failure: failed
      ? failed.type === "turn.failed"
        ? `codex turn.failed: ${failed.error?.message ?? JSON.stringify(failed).slice(0, 160)}`
        : `codex error: ${failed.message ?? JSON.stringify(failed).slice(0, 160)}`
      : undefined,
  };
}

async function runCodexFollowUp(sessionId: string, workdir: string): Promise<PhaseResult> {
  const start = Date.now();
  const args = [
    "exec", "resume", sessionId,
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--cd", workdir,
    "--json",
    "What exact content did you write to hello.txt? Reply with only that content, no other words.",
  ];
  let stdout: string;
  try {
    const res = await execFileAsync("codex", args, {
      cwd: workdir,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (err) {
    const e = err as Error & { stderr?: string };
    return {
      ok: false,
      sessionId: null,
      durationMs: Date.now() - start,
      notes: [`stderr head: ${(e.stderr ?? "").slice(0, 300)}`],
      failure: `codex follow-up failed: ${e.message}`,
    };
  }
  const durationMs = Date.now() - start;
  const events = parseJsonl(stdout);
  // Only agent_message items count as the final reply.
  // item.completed { item: { id, type: "agent_message", text } }
  const agentMessages: string[] = [];
  for (const e of events) {
    if (e?.type !== "item.completed") continue;
    if (e.item?.type !== "agent_message") continue;
    if (typeof e.item.text === "string") agentMessages.push(e.item.text);
  }
  const answer = agentMessages.join("\n");
  const failed = events.find((e) => e?.type === "turn.failed" || e?.type === "error");
  const recalled = answer.toLowerCase().includes(HELLO_CONTENT.toLowerCase());
  return {
    ok: recalled && !failed,
    sessionId,
    durationMs,
    notes: [
      `answer          = ${JSON.stringify(answer.trim().slice(0, 200))}`,
      `agent_msg count = ${agentMessages.length}`,
      `event count     = ${events.length}`,
      `recalled        = ${recalled}`,
    ],
    failure: failed
      ? `codex emitted ${failed.type}: ${failed.error?.message ?? failed.message ?? ""}`
      : recalled
      ? undefined
      : `follow-up did not recall "${HELLO_CONTENT}"`,
  };
}

function parseJsonl(stdout: string): any[] {
  const out: any[] = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // skip non-JSON lines — codex may interleave status text on stderr
      // but we also defensively skip malformed stdout lines.
    }
  }
  return out;
}

// -------- verification of worker deliverables --------

interface VerifyResult {
  ok: boolean;
  notes: string[];
  failures: string[];
}

function verifyArtifacts(workdir: string): VerifyResult {
  const notes: string[] = [];
  const failures: string[] = [];

  const helloPath = path.join(workdir, "hello.txt");
  if (!fs.existsSync(helloPath)) {
    failures.push(`missing hello.txt`);
  } else {
    const content = fs.readFileSync(helloPath, "utf8").trim();
    if (!content.includes(HELLO_CONTENT)) {
      failures.push(`hello.txt content mismatch: got ${JSON.stringify(content)}`);
    } else {
      notes.push(`hello.txt  = ${JSON.stringify(content)}`);
    }
  }

  const resultPath = path.join(workdir, "result.json");
  if (!fs.existsSync(resultPath)) {
    failures.push(`missing result.json`);
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(resultPath, "utf8"));
      if (parsed.schema_version !== "hydra/result/v0.1") {
        failures.push(`result.json schema_version = ${parsed.schema_version}`);
      }
      if (parsed.outcome !== "completed") {
        failures.push(`result.json outcome = ${parsed.outcome}`);
      }
      notes.push(
        `result.json outcome=${parsed.outcome} report_file=${parsed.report_file}`,
      );
    } catch (e) {
      failures.push(`result.json not valid JSON: ${(e as Error).message}`);
    }
  }

  const reportPath = path.join(workdir, "report.md");
  if (!fs.existsSync(reportPath)) {
    failures.push(`missing report.md`);
  } else {
    const content = fs.readFileSync(reportPath, "utf8").trim();
    if (!content) {
      failures.push(`report.md is empty`);
    } else {
      const snippet = content.length > 120 ? `${content.slice(0, 120)}…` : content;
      notes.push(`report.md  = ${JSON.stringify(snippet)}`);
    }
  }

  return { ok: failures.length === 0, notes, failures };
}

// -------- per-CLI runner --------

async function runSpike(cli: Cli): Promise<boolean> {
  console.log(`\n======== SPIKE: ${cli} ========`);

  const available = await which(cli);
  if (!available) {
    console.log(`  ⚠ ${cli} not on PATH — skipping`);
    return false;
  }

  const workdir = makeWorkdir(cli);
  console.log(`  workdir: ${workdir}`);

  console.log(`  [phase 1] dispatching worker via ${cli} subprocess...`);
  const dispatchFn = cli === "claude" ? runClaudeDispatch : runCodexDispatch;
  const dispatchResult = await dispatchFn(workdir);
  for (const n of dispatchResult.notes) console.log(`    ${n}`);
  if (!dispatchResult.ok) {
    console.log(`  ✗ phase 1 FAILED: ${dispatchResult.failure}`);
    return false;
  }
  console.log(`  ✓ phase 1 dispatch exited in ${dispatchResult.durationMs}ms`);

  console.log(`  [verify] worker deliverables...`);
  const verify = verifyArtifacts(workdir);
  for (const n of verify.notes) console.log(`    ${n}`);
  if (!verify.ok) {
    for (const f of verify.failures) console.log(`  ✗ ${f}`);
    return false;
  }
  console.log(`  ✓ all three deliverables present and valid`);

  if (!dispatchResult.sessionId) {
    console.log(`  ⚠ no session_id captured — phase 2 skipped`);
    return false;
  }

  console.log(`  [phase 2] follow-up via --resume ${dispatchResult.sessionId}`);
  const followUpFn = cli === "claude" ? runClaudeFollowUp : runCodexFollowUp;
  const followUpResult = await followUpFn(dispatchResult.sessionId, workdir);
  for (const n of followUpResult.notes) console.log(`    ${n}`);
  if (!followUpResult.ok) {
    console.log(`  ✗ phase 2 FAILED: ${followUpResult.failure}`);
    return false;
  }
  console.log(`  ✓ phase 2 follow-up exited in ${followUpResult.durationMs}ms`);

  console.log(`  ✅ ${cli}: PASSED`);
  return true;
}

async function main() {
  const { cli } = parseArgs();
  const targets: Cli[] = cli === "both" ? ["claude", "codex"] : [cli];
  const results: Record<string, boolean> = {};
  for (const t of targets) {
    try {
      results[t] = await runSpike(t);
    } catch (e) {
      console.log(`  ✗ ${t} threw: ${(e as Error).message}`);
      results[t] = false;
    }
  }
  console.log(`\n======== SUMMARY ========`);
  for (const [t, ok] of Object.entries(results)) {
    console.log(`  ${ok ? "✅ PASSED" : "❌ FAILED"}  ${t}`);
  }
  const allOk = Object.values(results).every(Boolean);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
