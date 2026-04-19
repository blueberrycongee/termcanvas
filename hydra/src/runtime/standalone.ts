import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  HydraRuntime,
  RuntimeTelemetrySnapshot,
  RuntimeTerminalRef,
  RuntimeTerminalStatus,
  TerminalCreateOptions,
} from "./types.ts";

/**
 * Standalone runtime — spawns claude/codex subprocesses directly and
 * tracks them via an in-memory map plus on-disk snapshots so that
 * long-running `hydra watch` and short-lived `hydra status` / `hydra
 * cleanup` invocations see a consistent view of a worker's state.
 *
 * Why no PTY: hydra already writes task.md + expects result.json from the
 * worker. Interactivity is not a requirement of the contract — only a
 * convenience of the TermCanvas UI. One-shot `claude -p --output-format
 * json` is sufficient and removes the node-pty / Electron / HTTP-server
 * dependency chain from the critical path.
 *
 * Layout of persisted state (per repo):
 *   <repo>/.hydra/runtime/standalone/
 *     lead-id                        # stable synthesized lead id, if env unset
 *     terminals/<terminalId>.json    # {pid, started_at, session_id, status, ...}
 *     terminals/<terminalId>.stdout  # streamed stdout from the worker
 *     terminals/<terminalId>.stderr  # streamed stderr from the worker
 */

interface ChildState {
  child: ChildProcess;
  pid: number;
  startedAt: number;
  sessionId: string | null;
  sessionProvider: "claude" | "codex" | null;
  exited: boolean;
  exitCode: number | null;
  stdoutChunks: string[];
  stderrChunks: string[];
  stdoutFd: number | null;
  stderrFd: number | null;
  snapshotPath: string;
  /** Set to the exit-time status once exit/error fires. */
  finalStatus?: "success" | "error";
}

interface PersistedTerminal {
  id: string;
  type: string;
  title: string;
  pid: number;
  started_at: string;
  status: "running" | "success" | "error" | "destroyed";
  session_id: string | null;
  session_provider: "claude" | "codex" | null;
  worktree_path: string;
  repo_path?: string;
  workbench_id?: string;
  assignment_id?: string;
  exit_code: number | null;
  updated_at: string;
}

const active: Map<string, ChildState> = new Map();

function runtimeDir(repoPath: string): string {
  return path.join(repoPath, ".hydra", "runtime", "standalone");
}

function terminalsDir(repoPath: string): string {
  return path.join(runtimeDir(repoPath), "terminals");
}

function terminalSnapshotPath(repoPath: string, terminalId: string): string {
  return path.join(terminalsDir(repoPath), `${terminalId}.json`);
}

/**
 * Global index that maps a terminalId to its repoPath, so cross-process
 * callers (e.g. `hydra watch` after `hydra dispatch` has exited) can
 * locate the snapshot without knowing which repo the terminal belongs to.
 */
function globalIndexDir(): string {
  return path.join(os.homedir(), ".hydra", "standalone", "index");
}

function globalIndexPath(terminalId: string): string {
  return path.join(globalIndexDir(), `${terminalId}`);
}

function recordGlobalIndex(terminalId: string, repoPath: string): void {
  try {
    fs.mkdirSync(globalIndexDir(), { recursive: true });
    fs.writeFileSync(globalIndexPath(terminalId), repoPath);
  } catch {
    // A missing global index just makes cross-process lookups fall back
    // to a repo scan — not fatal.
  }
}

function readGlobalIndex(terminalId: string): string | null {
  try {
    return fs.readFileSync(globalIndexPath(terminalId), "utf-8").trim();
  } catch {
    return null;
  }
}

function readSnapshot(snapshotPath: string): PersistedTerminal | null {
  try {
    return JSON.parse(fs.readFileSync(snapshotPath, "utf-8")) as PersistedTerminal;
  } catch {
    return null;
  }
}

function writeSnapshotAtomic(snapshotPath: string, data: PersistedTerminal): void {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const tmp = `${snapshotPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, snapshotPath);
}

/**
 * Find every repo that has a standalone runtime dir, so a terminalId can
 * be resolved to its snapshot even when the caller doesn't know the repo
 * it was spawned in. In practice callers always know the repo (every
 * Lead-op takes --repo) but a few code paths only see the terminal id.
 *
 * We cache the last repo we saw a given terminalId in to keep the hot
 * path O(1).
 */
const terminalRepoCache: Map<string, string> = new Map();

function findSnapshotAnyRepo(terminalId: string): { repoPath: string; snapshot: PersistedTerminal } | null {
  const cachedRepo = terminalRepoCache.get(terminalId);
  if (cachedRepo) {
    const snap = readSnapshot(terminalSnapshotPath(cachedRepo, terminalId));
    if (snap) return { repoPath: cachedRepo, snapshot: snap };
    terminalRepoCache.delete(terminalId);
  }
  // Fallback: in-process active map (current process).
  const live = active.get(terminalId);
  if (live) {
    const repoPath = path.resolve(path.dirname(live.snapshotPath), "..", "..", "..", "..");
    const snap = readSnapshot(live.snapshotPath);
    if (snap) {
      terminalRepoCache.set(terminalId, repoPath);
      return { repoPath, snapshot: snap };
    }
  }
  // Cross-process fallback: the global index points back to the originating repo.
  const indexedRepo = readGlobalIndex(terminalId);
  if (indexedRepo) {
    const snap = readSnapshot(terminalSnapshotPath(indexedRepo, terminalId));
    if (snap) {
      terminalRepoCache.set(terminalId, indexedRepo);
      return { repoPath: indexedRepo, snapshot: snap };
    }
  }
  return null;
}

/** Generate a terminal id that's stable across the process and visually scannable. */
function generateTerminalId(): string {
  return `subproc-${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * Build argv for `claude -p` / `codex exec` — mirrors the shape in
 * headless-runtime/subprocess-worker.ts so both paths stay consistent.
 */
function buildSubprocessArgv(
  opts: TerminalCreateOptions,
): { shell: string; args: string[] } {
  if (opts.type === "claude") {
    const args: string[] = ["-p", "--output-format", "json"];
    if (opts.autoApprove) args.push("--dangerously-skip-permissions");
    if (opts.model) args.push("--model", opts.model);
    if (opts.reasoningEffort) args.push("--effort", opts.reasoningEffort);
    if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId, "--fork-session");
    args.push(opts.prompt);
    return { shell: "claude", args };
  }

  if (opts.type === "codex") {
    const args: string[] = ["exec"];
    if (opts.resumeSessionId) args.push("resume", opts.resumeSessionId);
    if (opts.autoApprove) args.push("--dangerously-bypass-approvals-and-sandbox");
    args.push("--skip-git-repo-check", "--cd", opts.worktreePath, "--json");
    if (opts.model) args.push("-m", opts.model);
    if (opts.reasoningEffort) args.push("-c", `model_reasoning_effort=${opts.reasoningEffort}`);
    args.push(opts.prompt);
    return { shell: "codex", args };
  }

  throw new Error(`Standalone runtime supports only claude|codex, got: ${opts.type}`);
}

/**
 * Extract the session id from the subprocess stdout once it has exited.
 * claude: single JSON object (--output-format json) — top-level session_id.
 * codex: JSONL event stream (--json) — first thread.started event.
 */
function extractSessionId(type: string, stdout: string): string | null {
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
        const parsed = JSON.parse(trimmed) as { type?: unknown; thread_id?: unknown };
        if (parsed.type === "thread.started" && typeof parsed.thread_id === "string") {
          return parsed.thread_id;
        }
      } catch {
        // Skip non-JSON lines.
      }
    }
  }
  return null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Stable Lead id for a host — synthesized once per repo and persisted. */
function synthesizedLeadId(): string {
  const repoHint = process.env.HYDRA_STANDALONE_LEAD_REPO_HINT;
  const baseDir = repoHint
    ? runtimeDir(repoHint)
    : path.join(os.homedir(), ".hydra", "standalone");
  const idPath = path.join(baseDir, "lead-id");
  try {
    const existing = fs.readFileSync(idPath, "utf-8").trim();
    if (existing) return existing;
  } catch {
    // fall through to create
  }
  const id = `standalone-lead-${crypto.randomBytes(6).toString("hex")}`;
  try {
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(idPath, id);
  } catch {
    // If persistence fails we still return the id for this invocation; a
    // fresh id on the next invocation just means Lead ownership is not
    // enforced across processes — acceptable for standalone single-user.
  }
  return id;
}

// --- HydraRuntime implementation ---

export class StandaloneRuntime implements HydraRuntime {
  readonly name = "standalone" as const;

  isAvailable(): boolean {
    return true;
  }

  getCurrentLeadId(): string | undefined {
    // HYDRA_LEAD_ID takes precedence — lets callers pin a specific lead
    // (e.g. tests, multi-session scripts). Otherwise use a stable
    // synthesized id so ensureLeadCaller can compare consistently.
    return process.env.HYDRA_LEAD_ID ?? synthesizedLeadId();
  }

  ensureProjectTracked(repoPath: string): { id: string; path: string } {
    const abs = path.resolve(repoPath);
    // In standalone mode the repo path IS the project id. No registry to sync.
    fs.mkdirSync(runtimeDir(abs), { recursive: true });
    return { id: abs, path: abs };
  }

  syncProject(_repoPath: string): void {
    // No registry in standalone.
  }

  findProjectByPath(repoPath: string): { id: string; path: string } | null {
    const abs = path.resolve(repoPath);
    return { id: abs, path: abs };
  }

  terminalCreate(options: TerminalCreateOptions): RuntimeTerminalRef {
    if (options.type !== "claude" && options.type !== "codex") {
      throw new Error(
        `Standalone runtime supports only claude|codex, got: ${options.type}. ` +
          `Set HYDRA_STANDALONE=0 or run inside TermCanvas for other terminal types.`,
      );
    }

    const repoPath = options.repoPath ?? path.resolve(options.worktreePath);
    const terminalId = generateTerminalId();
    const { shell, args } = buildSubprocessArgv(options);

    fs.mkdirSync(terminalsDir(repoPath), { recursive: true });
    const snapshotPath = terminalSnapshotPath(repoPath, terminalId);
    const stdoutPath = path.join(terminalsDir(repoPath), `${terminalId}.stdout`);
    const stderrPath = path.join(terminalsDir(repoPath), `${terminalId}.stderr`);

    let stdoutFd: number | null = null;
    let stderrFd: number | null = null;
    try {
      stdoutFd = fs.openSync(stdoutPath, "w");
      stderrFd = fs.openSync(stderrPath, "w");
    } catch {
      // Logging is best-effort — the worker must still launch.
    }

    const child = spawn(shell, args, {
      cwd: options.worktreePath,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    if (!child.pid) {
      // spawn failed synchronously — clean up and surface the error.
      if (stdoutFd !== null) try { fs.closeSync(stdoutFd); } catch {}
      if (stderrFd !== null) try { fs.closeSync(stderrFd); } catch {}
      throw new Error(
        `Failed to spawn ${shell}: process has no pid. Is the CLI installed and on PATH?`,
      );
    }

    const startedAt = Date.now();
    const state: ChildState = {
      child,
      pid: child.pid,
      startedAt,
      sessionId: null,
      sessionProvider: options.type === "claude" || options.type === "codex" ? options.type : null,
      exited: false,
      exitCode: null,
      stdoutChunks: [],
      stderrChunks: [],
      stdoutFd,
      stderrFd,
      snapshotPath,
    };
    active.set(terminalId, state);
    terminalRepoCache.set(terminalId, repoPath);
    recordGlobalIndex(terminalId, repoPath);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      state.stdoutChunks.push(chunk);
      if (state.stdoutFd !== null) {
        try { fs.writeSync(state.stdoutFd, chunk); } catch {}
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      state.stderrChunks.push(chunk);
      if (state.stderrFd !== null) {
        try { fs.writeSync(state.stderrFd, chunk); } catch {}
      }
    });

    child.on("exit", (code: number | null) => {
      state.exited = true;
      state.exitCode = code;
      state.finalStatus = code === 0 ? "success" : "error";
      if (state.stdoutFd !== null) { try { fs.closeSync(state.stdoutFd); } catch {} state.stdoutFd = null; }
      if (state.stderrFd !== null) { try { fs.closeSync(state.stderrFd); } catch {} state.stderrFd = null; }

      const combinedStdout = state.stdoutChunks.join("");
      const sessionId = extractSessionId(options.type, combinedStdout);
      if (sessionId) state.sessionId = sessionId;
      writePersisted(state, {
        id: terminalId,
        type: options.type,
        title: `${options.type} ${terminalId}`,
        worktreePath: options.worktreePath,
        repoPath,
        workbenchId: options.workbenchId,
        assignmentId: options.assignmentId,
      });
    });

    child.on("error", () => {
      state.exited = true;
      state.exitCode = state.exitCode ?? -1;
      state.finalStatus = "error";
      if (state.stdoutFd !== null) { try { fs.closeSync(state.stdoutFd); } catch {} state.stdoutFd = null; }
      if (state.stderrFd !== null) { try { fs.closeSync(state.stderrFd); } catch {} state.stderrFd = null; }
      writePersisted(state, {
        id: terminalId,
        type: options.type,
        title: `${options.type} ${terminalId}`,
        worktreePath: options.worktreePath,
        repoPath,
        workbenchId: options.workbenchId,
        assignmentId: options.assignmentId,
      });
    });

    const title = `${options.type} ${terminalId}`;
    writePersisted(state, {
      id: terminalId,
      type: options.type,
      title,
      worktreePath: options.worktreePath,
      repoPath,
      workbenchId: options.workbenchId,
      assignmentId: options.assignmentId,
    });

    return { id: terminalId, type: options.type, title };
  }

  terminalStatus(terminalId: string): RuntimeTerminalStatus {
    const state = active.get(terminalId);
    if (state) {
      const status = state.exited
        ? (state.finalStatus ?? (state.exitCode === 0 ? "success" : "error"))
        : "running";
      return { id: terminalId, status, ptyId: null };
    }
    const found = findSnapshotAnyRepo(terminalId);
    if (!found) return { id: terminalId, status: "unknown", ptyId: null };
    // Cross-invocation: probe the pid to see if it's still alive.
    const alive = pidAlive(found.snapshot.pid);
    if (alive && found.snapshot.status === "running") {
      return { id: terminalId, status: "running", ptyId: null };
    }
    if (!alive && found.snapshot.status === "running") {
      // Pid went away behind our back — promote to error so cleanup
      // doesn't loop forever.
      const updated: PersistedTerminal = {
        ...found.snapshot,
        status: "error",
        updated_at: nowIso(),
      };
      writeSnapshotAtomic(terminalSnapshotPath(found.repoPath, terminalId), updated);
      return { id: terminalId, status: "error", ptyId: null };
    }
    return { id: terminalId, status: found.snapshot.status, ptyId: null };
  }

  terminalDestroy(terminalId: string): void {
    const state = active.get(terminalId);
    if (state && !state.exited) {
      try { state.child.kill("SIGTERM"); } catch {}
      // Give it a grace window; if still alive, SIGKILL. We don't block on
      // this — the exit handler will finalize the snapshot when the child
      // actually dies.
      setTimeout(() => {
        if (state.exited) return;
        try { state.child.kill("SIGKILL"); } catch {}
      }, 2000).unref?.();
      return;
    }
    const found = findSnapshotAnyRepo(terminalId);
    if (!found) return;
    if (found.snapshot.status === "running" && pidAlive(found.snapshot.pid)) {
      try { process.kill(found.snapshot.pid, "SIGTERM"); } catch {}
    }
    const updated: PersistedTerminal = {
      ...found.snapshot,
      status: found.snapshot.status === "running" ? "destroyed" : found.snapshot.status,
      updated_at: nowIso(),
    };
    writeSnapshotAtomic(terminalSnapshotPath(found.repoPath, terminalId), updated);
  }

  telemetryTerminal(terminalId: string): RuntimeTelemetrySnapshot | null {
    const state = active.get(terminalId);
    if (state) {
      return {
        session_id: state.sessionId,
        session_file: null,
        provider: state.sessionProvider,
        shell_pid: state.pid,
        pty_alive: !state.exited,
        derived_status: state.exited ? "stopped" : "working",
        last_meaningful_progress_at: new Date(state.startedAt).toISOString(),
      };
    }
    const found = findSnapshotAnyRepo(terminalId);
    if (!found) return null;
    const alive = found.snapshot.status === "running" && pidAlive(found.snapshot.pid);
    return {
      session_id: found.snapshot.session_id,
      session_file: null,
      provider: found.snapshot.session_provider,
      shell_pid: found.snapshot.pid,
      pty_alive: alive,
      derived_status: alive ? "working" : "stopped",
      last_meaningful_progress_at: found.snapshot.updated_at,
    };
  }
}

function writePersisted(
  state: ChildState,
  meta: {
    id: string;
    type: string;
    title: string;
    worktreePath: string;
    repoPath?: string;
    workbenchId?: string;
    assignmentId?: string;
  },
): void {
  const statusValue: PersistedTerminal["status"] = state.exited
    ? (state.finalStatus ?? (state.exitCode === 0 ? "success" : "error"))
    : "running";
  const snapshot: PersistedTerminal = {
    id: meta.id,
    type: meta.type,
    title: meta.title,
    pid: state.pid,
    started_at: new Date(state.startedAt).toISOString(),
    status: statusValue,
    session_id: state.sessionId,
    session_provider: state.sessionProvider,
    worktree_path: meta.worktreePath,
    repo_path: meta.repoPath,
    workbench_id: meta.workbenchId,
    assignment_id: meta.assignmentId,
    exit_code: state.exitCode,
    updated_at: nowIso(),
  };
  try {
    writeSnapshotAtomic(state.snapshotPath, snapshot);
  } catch {
    // A disk flake is not fatal — in-memory state is authoritative while
    // the process lives.
  }
}

/** Test helpers — exposed for unit tests only. */
export function _activeSubprocessCount(): number {
  return active.size;
}
export function _clearActiveForTests(): void {
  for (const state of active.values()) {
    try { state.child.kill("SIGKILL"); } catch {}
  }
  active.clear();
  terminalRepoCache.clear();
}
