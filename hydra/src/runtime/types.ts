/**
 * Runtime abstraction that lets hydra drive workers through either
 * TermCanvas (the original desktop/headless Electron-derived path) or a
 * pure subprocess path that spawns `claude` / `codex` directly with no
 * PTY, HTTP server, or project registry.
 *
 * Selection is centralized in ./index.ts (getRuntime). Every call-site in
 * hydra/src that previously reached into ./termcanvas.ts now goes through
 * this interface. The TermCanvas path is preserved exactly — the
 * standalone path is additive.
 */

export interface RuntimeTerminalRef {
  id: string;
  type: string;
  title: string;
}

export interface RuntimeTerminalStatus {
  id: string;
  status: string;
  ptyId: number | null;
}

export interface RuntimeTelemetrySnapshot {
  session_id?: string | null;
  session_file?: string | null;
  provider?: string | null;
  shell_pid?: number | null;
  pty_alive?: boolean;
  derived_status?: string;
  last_meaningful_progress_at?: string;
}

export interface TerminalCreateOptions {
  worktreePath: string;
  type: string;
  prompt: string;
  autoApprove?: boolean;
  parentTerminalId?: string;
  workbenchId?: string;
  assignmentId?: string;
  repoPath?: string;
  resumeSessionId?: string;
  model?: string;
  reasoningEffort?: string;
}

export interface HydraRuntime {
  readonly name: "termcanvas" | "standalone";

  /**
   * Dispatcher preflight. TermCanvas returns false when the TC daemon is
   * not running (no port file); Standalone always returns true.
   */
  isAvailable(): boolean;

  /**
   * Lead identity for ensureLeadCaller. TermCanvas returns
   * TERMCANVAS_TERMINAL_ID; Standalone returns HYDRA_LEAD_ID or a synthesized
   * stable id derived from process.pid + boot-time persisted to disk.
   */
  getCurrentLeadId(): string | undefined;

  /**
   * Register the repo on the TermCanvas canvas. No-op in standalone — the
   * repo path IS the project id.
   */
  ensureProjectTracked(repoPath: string): { id: string; path: string };

  /** Rescan a project. No-op in standalone. */
  syncProject(repoPath: string): void;

  /**
   * Look up an already-tracked repo/worktree. Standalone always returns the
   * repo as its own project.
   */
  findProjectByPath(repoPath: string): { id: string; path: string } | null;

  /**
   * Spawn a worker. TermCanvas creates a PTY terminal on the canvas;
   * Standalone spawns a claude/codex child process in one-shot mode and
   * synthesizes a terminal id.
   */
  terminalCreate(options: TerminalCreateOptions): RuntimeTerminalRef;

  /** Current status of a tracked worker. */
  terminalStatus(terminalId: string): RuntimeTerminalStatus;

  /** Tear down a tracked worker (best-effort kill in standalone). */
  terminalDestroy(terminalId: string): void;

  /**
   * Worker telemetry snapshot. TermCanvas proxies to `termcanvas telemetry
   * get`; standalone reads its in-memory / on-disk state.
   */
  telemetryTerminal(terminalId: string): RuntimeTelemetrySnapshot | null;
}
