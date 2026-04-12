import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TelemetryService } from "../electron/telemetry-service.ts";
import type { ServerEventBus } from "./event-bus.ts";
import type { ProjectStore, TerminalType } from "./project-store.ts";
import { CLI_LAUNCH } from "./terminal-launch.ts";

/**
 * Subprocess worker launcher — the non-interactive dual of
 * launchTrackedTerminal. Gated behind HYDRA_WORKER_MODE=subprocess (or an
 * explicit createWorkflowControl({ workerMode: "subprocess" }) opt-in).
 *
 * Unlike launchTrackedTerminal this does NOT create a PTY. Instead it
 * spawns the CLI in one-shot non-interactive mode:
 *   - claude: `claude -p --output-format json <flags> <prompt>`
 *   - codex:  `codex exec [resume <sid>] --json --cd <workdir> <flags> <prompt>`
 *
 * The worker contract is identical to the PTY path: the worker still reads
 * task.md and writes result.json + report.md. The difference is purely in
 * how the worker is launched and how its session id is captured:
 *   - PTY mode:        session_id is extracted by telemetry-service from
 *                      the session JSONL file tail after claude emits a
 *                      session_attached hook event
 *   - subprocess mode: session_id is parsed directly from the CLI's
 *                      structured stdout (claude's result JSON or codex's
 *                      thread.started event)
 *
 * This integrates with the existing terminal abstractions by registering a
 * "terminal" in projectStore + telemetry with ptyId=null. Downstream code
 * (workflow-lead's checkTerminalAlive, destroyTerminal, ledger recording)
 * works unchanged because it only queries terminal.status, which we update
 * on subprocess lifecycle events.
 *
 * Ground-truth references for CLI argv shapes:
 *   claude:
 *     - `claude --help` confirms -p/--print, --resume, --fork-session,
 *       --output-format json, --model, --effort, --dangerously-skip-permissions
 *   codex:
 *     - codex-rs/exec/src/cli.rs:8-215 (Cli + ResumeArgs clap definitions)
 *     - codex-rs/exec/src/exec_events.rs:39-43 (ThreadStartedEvent.thread_id)
 *     - codex-rs/exec/src/event_processor_with_jsonl_output.rs:105 (JSONL output)
 *     - codex -p means --profile (NOT print); must not collide with claude's -p
 *     - --skip-git-repo-check is required when workdir is not a git repo
 *     - --cd sets the agent's workspace root (distinct from process cwd)
 */

export interface SubprocessWorkerDeps {
  projectStore: ProjectStore;
  telemetryService: TelemetryService;
  eventBus?: ServerEventBus;
  onMutation?: () => void;
}

export interface LaunchSubprocessWorkerOptions extends SubprocessWorkerDeps {
  worktree: string;
  type: TerminalType;
  prompt: string;
  autoApprove?: boolean;
  parentTerminalId?: string;
  workflowId?: string;
  assignmentId?: string;
  repoPath?: string;
  resumeSessionId?: string;
  model?: string;
  reasoningEffort?: string;
  /**
   * Optional test seam. When provided, we call this instead of node:child_process.spawn.
   * Used by tests to avoid spawning real CLIs. Must return a ChildProcess-like object
   * with `on("exit", cb)`, `on("error", cb)`, `stdout`, `stderr`, and `kill`.
   */
  spawnImpl?: typeof spawn;
}

export interface LaunchSubprocessWorkerResult {
  id: string;
  type: TerminalType;
  title: string;
  projectId: string;
  worktreeId: string;
}

/**
 * Active child processes keyed by synthetic terminal id. Lets destroy paths
 * find and kill the right child when the Lead resets or times out a node.
 */
const activeSubprocesses = new Map<
  string,
  { child: ChildProcess; startedAt: number }
>();

interface SubprocessLaunchIntent {
  type: TerminalType;
  prompt: string;
  workdir: string;
  model?: string;
  reasoningEffort?: string;
  autoApprove?: boolean;
  resumeSessionId?: string;
}

/**
 * Build the full subprocess argv for a CLI. This is the subprocess-mode
 * analogue of terminal-launch.ts's flag builders — but returns an entire
 * argv vector rather than piecemeal fragments, because codex's resume path
 * reshapes the command skeleton (exec -> exec resume <id>) and cannot be
 * expressed as additive flags.
 */
function buildSubprocessArgv(
  intent: SubprocessLaunchIntent,
): { shell: string; args: string[] } {
  if (intent.type === "claude") {
    const args: string[] = ["-p", "--output-format", "json"];
    if (intent.autoApprove) {
      args.push("--dangerously-skip-permissions");
    }
    if (intent.model) {
      args.push("--model", intent.model);
    }
    if (intent.reasoningEffort) {
      args.push("--effort", intent.reasoningEffort);
    }
    if (intent.resumeSessionId) {
      // --fork-session keeps the original session file pristine; follow-ups
      // get a new session id so Dev's canonical history is not polluted by
      // third-party questions from Lead / Reviewer.
      args.push("--resume", intent.resumeSessionId, "--fork-session");
    }
    args.push(intent.prompt);
    return { shell: "claude", args };
  }

  if (intent.type === "codex") {
    const args: string[] = ["exec"];
    if (intent.resumeSessionId) {
      args.push("resume", intent.resumeSessionId);
    }
    if (intent.autoApprove) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    }
    args.push("--skip-git-repo-check", "--cd", intent.workdir, "--json");
    if (intent.model) {
      args.push("-m", intent.model);
    }
    if (intent.reasoningEffort) {
      args.push("-c", `model_reasoning_effort=${intent.reasoningEffort}`);
    }
    args.push(intent.prompt);
    return { shell: "codex", args };
  }

  throw Object.assign(
    new Error(
      `subprocess worker mode supports only claude|codex, got: ${intent.type}`,
    ),
    { status: 400 },
  );
}

/**
 * Parse session id from the CLI's structured stdout.
 *
 * claude: single-object JSON result envelope (--output-format json). The
 *   top-level `session_id` field is present on both success and error paths.
 *
 * codex: JSONL event stream (--json). The `thread.started` event is emitted
 *   first and carries `thread_id`, which is codex's session id under the hood
 *   (exec_events.rs:39-43; also set from session_configured.session_id at
 *   event_processor_with_jsonl_output.rs:394).
 */
function extractSessionId(
  type: TerminalType,
  stdout: string,
): string | null {
  if (type === "claude") {
    try {
      const parsed = JSON.parse(stdout) as { session_id?: unknown };
      return typeof parsed.session_id === "string" ? parsed.session_id : null;
    } catch {
      return null;
    }
  }

  if (type === "codex") {
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as {
          type?: unknown;
          thread_id?: unknown;
        };
        if (
          parsed.type === "thread.started" &&
          typeof parsed.thread_id === "string"
        ) {
          return parsed.thread_id;
        }
      } catch {
        // skip non-JSON lines
      }
    }
    return null;
  }

  return null;
}

export async function launchSubprocessWorker(
  options: LaunchSubprocessWorkerOptions,
): Promise<LaunchSubprocessWorkerResult> {
  const found = options.projectStore.findWorktree(options.worktree);
  if (!found) {
    throw Object.assign(new Error("Worktree not found on canvas"), {
      status: 404,
    });
  }

  if (options.type !== "claude" && options.type !== "codex") {
    throw Object.assign(
      new Error(
        `subprocess worker mode supports only claude|codex, got: ${options.type}`,
      ),
      { status: 400 },
    );
  }

  // Reuse the adapter's capability checks so that model/reasoning_effort
  // validation matches the PTY path exactly — roles pin per-CLI, and
  // subprocess mode should reject the same invalid pins.
  const adapter = CLI_LAUNCH[options.type];
  if (adapter) {
    if (options.model && !adapter.supportsModel()) {
      throw Object.assign(
        new Error(
          `Terminal type "${options.type}" does not support model selection (requested model: ${options.model}).`,
        ),
        { status: 400 },
      );
    }
    if (options.reasoningEffort && !adapter.supportsReasoningEffort()) {
      throw Object.assign(
        new Error(
          `Terminal type "${options.type}" does not support reasoning effort selection (requested level: ${options.reasoningEffort}).`,
        ),
        { status: 400 },
      );
    }
  }

  // Register a terminal record with ptyId intentionally null. This is the
  // key compatibility trick: telemetry-service.registerTerminal handles
  // ptyId=null explicitly (telemetry-service.ts:381 pty_alive=false branch),
  // and workflow-lead.checkTerminalAlive queries terminal.status which we
  // update on subprocess lifecycle events.
  const terminal = options.projectStore.addTerminal(
    found.projectId,
    found.worktreeId,
    options.type,
    options.prompt,
    options.autoApprove,
    options.parentTerminalId,
  );

  const { shell, args } = buildSubprocessArgv({
    type: options.type,
    prompt: options.prompt,
    workdir: options.worktree,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    autoApprove: options.autoApprove,
    resumeSessionId: options.resumeSessionId,
  });

  options.telemetryService.registerTerminal({
    terminalId: terminal.id,
    worktreePath: options.worktree,
    provider:
      options.type === "claude" || options.type === "codex"
        ? options.type
        : "unknown",
    workflowId: options.workflowId,
    assignmentId: options.assignmentId,
    repoPath: options.repoPath,
    ptyId: null,
    shellPid: null,
  });

  // Use spawn (not execFile) so that long-running workers never buffer their
  // entire stdout before resolving. We append each chunk to stdoutChunks AND
  // stream it to an on-disk log for UI tailing / post-mortem audit.
  const spawnFn = options.spawnImpl ?? spawn;
  const child = spawnFn(shell, args, {
    cwd: options.worktree,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let streamLogFd: number | null = null;
  if (options.repoPath && options.workflowId) {
    const logDir = path.join(
      options.repoPath,
      ".hydra",
      "workflows",
      options.workflowId,
      "subprocess",
    );
    try {
      fs.mkdirSync(logDir, { recursive: true });
      streamLogFd = fs.openSync(
        path.join(logDir, `${terminal.id}.stream.jsonl`),
        "w",
      );
    } catch {
      streamLogFd = null;
    }
  }

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutChunks.push(chunk);
    if (streamLogFd !== null) {
      try {
        fs.writeSync(streamLogFd, chunk);
      } catch {
        // Logging must never break the worker lifecycle.
      }
    }
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderrChunks.push(chunk);
  });

  options.projectStore.updateTerminalStatus(
    found.projectId,
    found.worktreeId,
    terminal.id,
    "running",
  );
  activeSubprocesses.set(terminal.id, { child, startedAt: Date.now() });

  child.on("exit", (exitCode: number | null) => {
    activeSubprocesses.delete(terminal.id);
    if (streamLogFd !== null) {
      try {
        fs.closeSync(streamLogFd);
      } catch {}
      streamLogFd = null;
    }

    const stdout = stdoutChunks.join("");
    const sessionId = extractSessionId(options.type, stdout);
    if (sessionId) {
      try {
        options.telemetryService.recordSessionAttached({
          terminalId: terminal.id,
          provider: options.type === "codex" ? "codex" : "claude",
          sessionId,
          confidence: "strong",
        });
      } catch {
        // telemetry failure must not break workflow state
      }
    }

    const status = exitCode === 0 ? "success" : "error";
    options.projectStore.updateTerminalStatus(
      found.projectId,
      found.worktreeId,
      terminal.id,
      status,
    );
    options.onMutation?.();
    options.eventBus?.emit("terminal_status_changed", {
      terminalId: terminal.id,
      status,
      exitCode: exitCode ?? -1,
    });
  });

  child.on("error", () => {
    // Spawn itself failed — binary not found, permission denied, etc.
    activeSubprocesses.delete(terminal.id);
    if (streamLogFd !== null) {
      try {
        fs.closeSync(streamLogFd);
      } catch {}
      streamLogFd = null;
    }
    options.projectStore.updateTerminalStatus(
      found.projectId,
      found.worktreeId,
      terminal.id,
      "error",
    );
    options.onMutation?.();
    options.eventBus?.emit("terminal_status_changed", {
      terminalId: terminal.id,
      status: "error",
      exitCode: -1,
    });
  });

  options.onMutation?.();
  options.eventBus?.emit("terminal_status_changed", {
    terminalId: terminal.id,
    status: "running",
  });
  options.eventBus?.emit("terminal_created", {
    terminalId: terminal.id,
    type: terminal.type,
  });

  return {
    id: terminal.id,
    type: terminal.type,
    title: terminal.title,
    projectId: found.projectId,
    worktreeId: found.worktreeId,
  };
}

/**
 * Kill the child process for a subprocess-backed terminal, if one is active.
 * Returns true if a subprocess was found and killed, false otherwise.
 * Callers (e.g. workflow-control's destroyTerminal) can call this
 * unconditionally — it is a no-op for PTY-backed terminals.
 */
export function destroySubprocessWorker(terminalId: string): boolean {
  const entry = activeSubprocesses.get(terminalId);
  if (!entry) return false;
  try {
    entry.child.kill("SIGHUP");
  } catch {
    // child may already be dead; ignore
  }
  activeSubprocesses.delete(terminalId);
  return true;
}

/**
 * Test-only accessor — the production registry is module-private, but tests
 * occasionally need to assert on its state (e.g. "after launch+exit, nothing
 * is leaked").
 */
export function _activeSubprocessCount(): number {
  return activeSubprocesses.size;
}
