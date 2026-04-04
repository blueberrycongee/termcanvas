import fs from "node:fs";
import path from "node:path";
import {
  HandoffManager,
} from "../hydra/src/handoff/manager.ts";
import type { Handoff } from "../hydra/src/handoff/types.ts";
import {
  validateDoneMarker,
  validateResultContract,
} from "../hydra/src/protocol.ts";
import { loadWorkflow } from "../hydra/src/workflow-store.ts";
import { getProcessSnapshot } from "./process-detector.ts";
import { parseSessionTelemetryLine } from "./session-watcher.ts";
import type {
  NormalizedSessionTelemetryEvent,
  SessionAttachConfidence,
  TelemetryDerivedStatus,
  TelemetryEvent,
  TelemetryEventPage,
  TelemetryProcessInfo,
  TelemetryProvider,
  TelemetryTurnState,
  TerminalTelemetrySnapshot,
  WorkflowTelemetrySnapshot,
} from "../shared/telemetry.ts";
import type { SessionInfo } from "../shared/sessions.ts";

const DEFAULT_EVENT_LIMIT = 200;
const DEFAULT_STALL_THRESHOLD_MS = 45_000;

interface TerminalState {
  id: string;
  events: TelemetryEvent[];
  nextEventId: number;
  lastContractKey: string | null;
  lastHookToolAt: number;
  lastProcessKey: string | null;
  pendingPreToolUse: boolean;
  pendingPreToolUseAt: number;
  lastTokenTotal: number | null;
  processPollTimer: NodeJS.Timeout | null;
  ptyId: number | null;
  sessionFile: string | null;
  sessionPollTimer: NodeJS.Timeout | null;
  sessionReadInFlight: boolean;
  sessionRemainder: string;
  sessionWatcher: fs.FSWatcher | null;
  sessionOffset: number;
  shellPid: number | null;
  snapshot: TerminalTelemetrySnapshot;
}

interface RegisterTerminalInput {
  terminalId: string;
  worktreePath: string;
  provider?: TelemetryProvider;
  workflowId?: string;
  handoffId?: string;
  repoPath?: string;
  ptyId?: number | null;
  shellPid?: number | null;
}

interface UpdateTerminalInput {
  terminalId: string;
  worktreePath?: string;
  provider?: TelemetryProvider;
  workflowId?: string;
  handoffId?: string;
  repoPath?: string;
  ptyId?: number | null;
  shellPid?: number | null;
}

interface SessionAttachInput {
  terminalId: string;
  provider: TelemetryProvider;
  sessionId: string;
  confidence: SessionAttachConfidence;
  sessionFile?: string;
  at?: string;
}

interface ContractState {
  resultExists: boolean;
  doneExists: boolean;
  resultValid?: boolean;
  doneValid?: boolean;
  contractActivityAt?: string;
}

function isoNow(now: () => number): string {
  return new Date(now()).toISOString();
}

function cloneSnapshot(snapshot: TerminalTelemetrySnapshot): TerminalTelemetrySnapshot {
  return {
    ...snapshot,
    descendant_processes: snapshot.descendant_processes.map((process) => ({ ...process })),
  };
}

function latestIso(...values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1);
}

function safeMtime(filePath: string): string | undefined {
  try {
    return new Date(fs.statSync(filePath).mtimeMs).toISOString();
  } catch {
    return undefined;
  }
}

function summarizeProcesses(processes: TelemetryProcessInfo[]): string {
  return JSON.stringify(
    processes.map((process) => ({
      pid: process.pid,
      command: process.command,
      cli_type: process.cli_type ?? null,
    })),
  );
}

export function deriveTelemetryStatus(
  snapshot: TerminalTelemetrySnapshot,
  nowMs = Date.now(),
  stallThresholdMs = DEFAULT_STALL_THRESHOLD_MS,
): TelemetryDerivedStatus {
  if (!snapshot.pty_alive) {
    return "exited";
  }

  if (snapshot.turn_state === "turn_complete" && snapshot.last_hook_error) {
    return "error";
  }

  if (
    snapshot.turn_state === "turn_complete" &&
    snapshot.handoff_id &&
    !snapshot.done_exists &&
    !snapshot.result_exists
  ) {
    return "awaiting_contract";
  }

  if (
    !snapshot.session_attached &&
    !snapshot.last_input_at &&
    !snapshot.last_output_at &&
    !snapshot.last_meaningful_progress_at
  ) {
    return "starting";
  }

  if (
    snapshot.turn_state === "thinking" ||
    snapshot.turn_state === "tool_running" ||
    snapshot.turn_state === "tool_pending" ||
    !!snapshot.foreground_tool
  ) {
    return "progressing";
  }

  if (snapshot.last_meaningful_progress_at) {
    const lastProgressMs = new Date(snapshot.last_meaningful_progress_at).getTime();
    if (Number.isFinite(lastProgressMs) && nowMs - lastProgressMs <= stallThresholdMs) {
      return "progressing";
    }
  }

  if (snapshot.last_output_at || snapshot.last_input_at) {
    return "stall_candidate";
  }

  return "starting";
}

function buildBaseSnapshot(input: RegisterTerminalInput): TerminalTelemetrySnapshot {
  return {
    terminal_id: input.terminalId,
    worktree_path: input.worktreePath,
    provider: input.provider ?? "unknown",
    workflow_id: input.workflowId,
    handoff_id: input.handoffId,
    repo_path: input.repoPath,
    session_attached: false,
    session_attach_confidence: "none",
    turn_state: "unknown",
    pty_alive: false,
    descendant_processes: [],
    done_exists: false,
    result_exists: false,
    derived_status: "starting",
  };
}

export class TelemetryService {
  private readonly eventLimit: number;
  private readonly now: () => number;
  private readonly processPollIntervalMs: number;
  private readonly sessionPollIntervalMs: number;
  private readonly sessionPrimeBytes: number;
  private readonly stallThresholdMs: number;
  private readonly ptyToTerminal = new Map<number, string>();
  private readonly terminals = new Map<string, TerminalState>();
  private readonly onSnapshotChanged?: (terminalId: string, snapshot: TerminalTelemetrySnapshot) => void;

  constructor(options?: {
    eventLimit?: number;
    now?: () => number;
    processPollIntervalMs?: number;
    sessionPollIntervalMs?: number;
    sessionPrimeBytes?: number;
    stallThresholdMs?: number;
    onSnapshotChanged?: (terminalId: string, snapshot: TerminalTelemetrySnapshot) => void;
  }) {
    this.eventLimit = options?.eventLimit ?? DEFAULT_EVENT_LIMIT;
    this.now = options?.now ?? Date.now;
    this.processPollIntervalMs = options?.processPollIntervalMs ?? 15_000;
    this.sessionPollIntervalMs = options?.sessionPollIntervalMs ?? 10_000;
    this.sessionPrimeBytes = options?.sessionPrimeBytes ?? 262_144;
    this.stallThresholdMs = options?.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
    this.onSnapshotChanged = options?.onSnapshotChanged;
  }

  registerTerminal(input: RegisterTerminalInput): TerminalTelemetrySnapshot {
    const state = this.ensureState(input.terminalId, input);
    state.snapshot.worktree_path = input.worktreePath;
    state.snapshot.provider = input.provider ?? state.snapshot.provider;
    state.snapshot.workflow_id = input.workflowId ?? state.snapshot.workflow_id;
    state.snapshot.handoff_id = input.handoffId ?? state.snapshot.handoff_id;
    state.snapshot.repo_path = input.repoPath ?? state.snapshot.repo_path;
    if (input.ptyId !== undefined) {
      if (state.ptyId !== null && state.ptyId !== input.ptyId) {
        this.ptyToTerminal.delete(state.ptyId);
      }
      state.ptyId = input.ptyId;
      state.snapshot.pty_alive = input.ptyId !== null;
      if (input.ptyId !== null) {
        this.ptyToTerminal.set(input.ptyId, input.terminalId);
      }
    }
    if (input.shellPid !== undefined) {
      state.shellPid = input.shellPid;
    }
    return this.getTerminalSnapshot(input.terminalId)!;
  }

  updateTerminal(input: UpdateTerminalInput): TerminalTelemetrySnapshot {
    const state = this.ensureState(input.terminalId);
    if (input.worktreePath !== undefined) {
      state.snapshot.worktree_path = input.worktreePath;
    }
    if (input.provider !== undefined) {
      state.snapshot.provider = input.provider;
    }
    state.snapshot.workflow_id = input.workflowId ?? state.snapshot.workflow_id;
    state.snapshot.handoff_id = input.handoffId ?? state.snapshot.handoff_id;
    state.snapshot.repo_path = input.repoPath ?? state.snapshot.repo_path;
    if (input.ptyId !== undefined) {
      if (state.ptyId !== null && state.ptyId !== input.ptyId) {
        this.ptyToTerminal.delete(state.ptyId);
      }
      state.ptyId = input.ptyId;
      state.snapshot.pty_alive = input.ptyId !== null;
      if (input.ptyId !== null) {
        this.ptyToTerminal.set(input.ptyId, input.terminalId);
      }
    }
    if (input.shellPid !== undefined) {
      state.shellPid = input.shellPid;
    }
    this.updateDerivedStatus(state);
    return cloneSnapshot(state.snapshot);
  }

  recordPtyCreated(input: {
    terminalId: string;
    ptyId: number;
    shellPid?: number | null;
    at?: string;
  }): void {
    const state = this.ensureState(input.terminalId);
    if (state.ptyId !== null && state.ptyId !== input.ptyId) {
      this.ptyToTerminal.delete(state.ptyId);
    }
    state.ptyId = input.ptyId;
    state.shellPid = input.shellPid ?? state.shellPid;
    state.snapshot.pty_alive = true;
    state.snapshot.exit_code = undefined;
    this.ptyToTerminal.set(input.ptyId, input.terminalId);
    this.appendEvent(state, input.at, "pty", "pty_created", {
      pty_id: input.ptyId,
      shell_pid: input.shellPid ?? null,
    });
    if (typeof input.shellPid === "number") {
      this.startProcessPolling(input.terminalId, input.shellPid);
    }
    this.updateDerivedStatus(state);
  }

  recordPtyInput(terminalId: string, data: string, at?: string): void {
    const state = this.ensureState(terminalId);
    const timestamp = at ?? isoNow(this.now);
    state.snapshot.last_input_at = timestamp;
    this.appendEvent(state, timestamp, "pty", "pty_input", { bytes: data.length });
    this.updateDerivedStatus(state);
  }

  recordPtyInputByPtyId(ptyId: number, data: string, at?: string): void {
    const terminalId = this.ptyToTerminal.get(ptyId);
    if (!terminalId) return;
    this.recordPtyInput(terminalId, data, at);
  }

  recordPtyOutput(terminalId: string, data: string, at?: string): void {
    const state = this.ensureState(terminalId);
    const timestamp = at ?? isoNow(this.now);
    state.snapshot.last_output_at = timestamp;
    this.appendEvent(state, timestamp, "pty", "pty_output", { bytes: data.length });
    this.updateDerivedStatus(state);
  }

  recordPtyOutputByPtyId(ptyId: number, data: string, at?: string): void {
    const terminalId = this.ptyToTerminal.get(ptyId);
    if (!terminalId) return;
    this.recordPtyOutput(terminalId, data, at);
  }

  recordPtyExit(terminalId: string, exitCode: number, at?: string): void {
    const state = this.ensureState(terminalId);
    const timestamp = at ?? isoNow(this.now);
    if (state.ptyId !== null) {
      this.ptyToTerminal.delete(state.ptyId);
    }
    state.ptyId = null;
    state.snapshot.pty_alive = false;
    state.snapshot.exit_code = exitCode;
    this.stopProcessPolling(state);
    this.appendEvent(state, timestamp, "pty", "pty_exit", { exit_code: exitCode });
    this.updateDerivedStatus(state);
  }

  recordPtyExitByPtyId(ptyId: number, exitCode: number, at?: string): void {
    const terminalId = this.ptyToTerminal.get(ptyId);
    if (!terminalId) return;
    const state = this.terminals.get(terminalId);
    if (state?.ptyId !== ptyId) {
      this.ptyToTerminal.delete(ptyId);
      return;
    }
    this.recordPtyExit(terminalId, exitCode, at);
  }

  recordSessionAttached(input: SessionAttachInput): void {
    const state = this.ensureState(input.terminalId);
    const timestamp = input.at ?? isoNow(this.now);
    state.snapshot.provider = input.provider;
    state.snapshot.session_attached = true;
    state.snapshot.session_attach_confidence = input.confidence;
    state.snapshot.session_id = input.sessionId;
    state.snapshot.session_file = input.sessionFile;
    this.appendEvent(state, timestamp, "session", "session_attached", {
      provider: input.provider,
      session_id: input.sessionId,
      session_attach_confidence: input.confidence,
      session_file: input.sessionFile ?? null,
    });
    this.updateDerivedStatus(state);
  }

  attachSessionSource(input: SessionAttachInput): void {
    this.recordSessionAttached(input);
    const state = this.ensureState(input.terminalId);
    this.stopSessionTracking(state);
    state.sessionFile = input.sessionFile ?? null;
    state.sessionOffset = 0;
    state.sessionRemainder = "";
    if (!state.sessionFile) {
      return;
    }
    this.primeSessionFromTail(state);
    this.startSessionTracking(state);
  }

  recordSessionAttachFailed(
    terminalId: string,
    reason: string,
    at?: string,
  ): void {
    const state = this.ensureState(terminalId);
    const timestamp = at ?? isoNow(this.now);
    this.appendEvent(state, timestamp, "session", "session_attach_failed", { reason });
    this.updateDerivedStatus(state);
  }

  detachSessionSource(terminalId: string): void {
    const state = this.terminals.get(terminalId);
    if (!state) return;
    this.stopSessionTracking(state);
  }

  recordSessionTelemetry(
    terminalId: string,
    events: NormalizedSessionTelemetryEvent[],
  ): void {
    const state = this.ensureState(terminalId);
    for (const event of events) {
      const timestamp = event.at ?? isoNow(this.now);
      const previousTurnState = state.snapshot.turn_state;
      state.snapshot.last_session_event_at = timestamp;
      state.snapshot.last_session_event_kind = event.event_type;
      if (event.turn_state) {
        state.snapshot.turn_state = event.turn_state;
      }

      let meaningfulProgress = event.meaningful_progress === true;
      if (event.event_type === "token_count" && typeof event.token_total === "number") {
        if (state.lastTokenTotal === null || event.token_total > state.lastTokenTotal) {
          meaningfulProgress = true;
        }
        state.lastTokenTotal = event.token_total;
      }

      if (meaningfulProgress) {
        state.snapshot.last_meaningful_progress_at = timestamp;
      }

      this.appendEvent(state, timestamp, "session", "session_event", {
        event_type: event.event_type,
        event_subtype: event.event_subtype ?? null,
        role: event.role ?? null,
        tool_name: event.tool_name ?? null,
        token_total: event.token_total ?? null,
        raw_ref: event.raw_ref ?? null,
      });

      if (event.turn_state && event.turn_state !== previousTurnState) {
        this.appendEvent(state, timestamp, "session", "session_turn_state_changed", {
          from: previousTurnState,
          to: event.turn_state,
        });
      }
    }

    this.updateDerivedStatus(state);
  }

  recordProcessSnapshot(
    terminalId: string,
    snapshot: {
      descendantProcesses: TelemetryProcessInfo[];
      foregroundTool: string | null;
    },
    at?: string,
  ): void {
    const state = this.ensureState(terminalId);
    const timestamp = at ?? isoNow(this.now);
    const processKey = summarizeProcesses(snapshot.descendantProcesses);
    const previousForegroundTool = state.snapshot.foreground_tool;
    const hasMeaningfulChange =
      state.lastProcessKey !== processKey ||
      previousForegroundTool !== (snapshot.foregroundTool ?? undefined);

    state.lastProcessKey = processKey;
    state.snapshot.process_snapshot_at = timestamp;
    state.snapshot.descendant_processes = snapshot.descendantProcesses.map((process) => ({
      ...process,
    }));

    // Don't let ps data overwrite hook-set foreground_tool while a tool is running
    if (state.pendingPreToolUse) {
      // Auto-reset if stuck for >5 minutes (CC crashed without PostToolUse)
      if (this.now() - state.pendingPreToolUseAt > 5 * 60_000) {
        console.warn(
          `[Telemetry] Resetting stale pendingPreToolUse for terminal=${terminalId} (>5min without PostToolUse)`,
        );
        state.pendingPreToolUse = false;
        state.snapshot.turn_state = "unknown";
        state.snapshot.foreground_tool = snapshot.foregroundTool ?? undefined;
      }
    } else {
      state.snapshot.foreground_tool = snapshot.foregroundTool ?? undefined;
    }

    if (hasMeaningfulChange) {
      state.snapshot.last_meaningful_progress_at = timestamp;
    }

    this.appendEvent(state, timestamp, "process", "process_snapshot", {
      descendant_processes: snapshot.descendantProcesses,
      foreground_tool: snapshot.foregroundTool,
    });

    if (previousForegroundTool !== state.snapshot.foreground_tool) {
      this.appendEvent(state, timestamp, "process", "foreground_tool_changed", {
        from: previousForegroundTool ?? null,
        to: state.snapshot.foreground_tool ?? null,
      });
    }

    this.updateDerivedStatus(state);
  }

  recordGitActivity(terminalId: string, at?: string): void {
    const state = this.ensureState(terminalId);
    const timestamp = at ?? isoNow(this.now);
    state.snapshot.git_activity_at = timestamp;
    state.snapshot.worktree_activity_at = timestamp;
    state.snapshot.last_meaningful_progress_at = timestamp;
    this.appendEvent(state, timestamp, "worktree", "git_activity", {
      worktree_path: state.snapshot.worktree_path,
    });
    this.updateDerivedStatus(state);
  }

  getTerminalSnapshot(terminalId: string): TerminalTelemetrySnapshot | null {
    const state = this.terminals.get(terminalId);
    if (!state) return null;
    this.syncContractState(state);
    this.updateDerivedStatus(state);
    return cloneSnapshot(state.snapshot);
  }

  listTerminalEvents(input: {
    terminalId: string;
    limit?: number;
    cursor?: string;
  }): TelemetryEventPage {
    const state = this.terminals.get(input.terminalId);
    if (!state) return { events: [] };
    const limit = Math.max(1, input.limit ?? 50);
    const allEvents = state.events;
    const cursorIndex = input.cursor
      ? allEvents.findIndex((event) => event.id === input.cursor)
      : allEvents.length;
    const end = cursorIndex >= 0 ? cursorIndex : allEvents.length;
    const start = Math.max(0, end - limit);
    const events = allEvents.slice(start, end);
    return {
      events: events.map((event) => ({ ...event, data: { ...event.data } })),
      next_cursor: start > 0 ? allEvents[start].id : undefined,
    };
  }

  getWorkflowSnapshot(repoPath: string, workflowId: string): WorkflowTelemetrySnapshot | null {
    const workflow = loadWorkflow(repoPath, workflowId);
    if (!workflow) return null;

    const handoffManager = new HandoffManager(repoPath);
    const handoff = handoffManager.load(workflow.current_handoff_id);
    if (!handoff) return null;

    const terminalId = handoff.dispatch?.active_terminal_id ?? null;
    const terminal = terminalId ? this.getTerminalSnapshot(terminalId) : null;
    const contract = this.probeContractState(handoff);
    const lastMeaningfulProgressAt = latestIso(
      terminal?.last_meaningful_progress_at,
      contract.contractActivityAt,
    );

    const startedAt = handoff.dispatch?.attempts.at(-1)?.started_at ?? workflow.updated_at;
    const startedMs = new Date(startedAt).getTime();
    const deadlineMs =
      Number.isFinite(startedMs) && typeof handoff.timeout_minutes === "number"
        ? startedMs + handoff.timeout_minutes * 60_000
        : undefined;

    return {
      workflow_id: workflow.id,
      repo_path: workflow.repo_path,
      workflow_status: workflow.status,
      current_handoff_id: handoff.id,
      terminal_id: terminalId,
      terminal,
      contract: {
        result_exists: contract.resultExists,
        done_exists: contract.doneExists,
        result_valid: contract.resultValid,
        done_valid: contract.doneValid,
        contract_activity_at: contract.contractActivityAt,
      },
      last_meaningful_progress_at: lastMeaningfulProgressAt,
      retry_budget: {
        used: handoff.retry_count,
        max: handoff.max_retries,
        remaining: Math.max(0, handoff.max_retries - handoff.retry_count),
      },
      timeout_budget: {
        minutes: handoff.timeout_minutes ?? workflow.timeout_minutes,
        started_at: startedAt,
        deadline_at: deadlineMs ? new Date(deadlineMs).toISOString() : undefined,
        remaining_ms:
          deadlineMs !== undefined ? Math.max(0, deadlineMs - this.now()) : undefined,
      },
      advisory_status: terminal?.derived_status ?? "unavailable",
    };
  }

  recordHookEvent(terminalId: string, event: {
    hook_event_name: string;
    session_id?: string;
    transcript_path?: string;
    cwd?: string;
    [key: string]: unknown;
  }): void {
    const state = this.ensureState(terminalId);
    const at = isoNow(this.now);

    switch (event.hook_event_name) {
      case "SessionStart":
        if (event.session_id) {
          this.recordSessionAttached({
            terminalId,
            provider: "claude",
            sessionId: event.session_id as string,
            confidence: "strong",
            sessionFile: (event.transcript_path as string) ?? undefined,
          });
          if (event.transcript_path) {
            this.attachSessionSource({
              terminalId,
              provider: "claude",
              sessionId: event.session_id as string,
              confidence: "strong",
              sessionFile: event.transcript_path as string,
            });
          }
        }
        state.snapshot.last_hook_error = undefined;
        state.snapshot.last_hook_error_details = undefined;
        this.appendEvent(state, at, "session", "hook_session_start", {
          session_id: event.session_id ?? null,
          source: event.source ?? null,
          model: event.model ?? null,
        });
        break;

      case "Stop":
        state.pendingPreToolUse = false;
        state.snapshot.last_hook_error = undefined;
        state.snapshot.last_hook_error_details = undefined;
        state.snapshot.turn_state = "turn_complete";
        state.snapshot.last_meaningful_progress_at = at;
        this.appendEvent(state, at, "session", "hook_stop", {
          last_assistant_message: event.last_assistant_message ?? null,
        });
        break;

      case "StopFailure":
        state.pendingPreToolUse = false;
        state.snapshot.turn_state = "turn_complete";
        state.snapshot.last_hook_error = typeof event.error === "string" ? event.error : "unknown";
        state.snapshot.last_hook_error_details = typeof event.error_details === "string" ? event.error_details : undefined;
        this.appendEvent(state, at, "session", "hook_stop_failure", {
          error: event.error ?? null,
          error_details: event.error_details ?? null,
          last_assistant_message: event.last_assistant_message ?? null,
        });
        break;

      case "PreToolUse":
        if (state.pendingPreToolUse) {
          console.warn(
            `[Telemetry] Missed PostToolUse for terminal=${terminalId} (new PreToolUse arrived while pending)`,
          );
        }
        state.pendingPreToolUse = true;
        state.pendingPreToolUseAt = this.now();
        state.snapshot.turn_state = "tool_running";
        state.snapshot.last_meaningful_progress_at = at;
        state.snapshot.foreground_tool = event.tool_name as string | undefined;
        state.lastHookToolAt = this.now();
        this.appendEvent(state, at, "session", "hook_pre_tool", {
          tool_name: event.tool_name ?? null,
        });
        break;

      case "PostToolUse":
        state.pendingPreToolUse = false;
        state.snapshot.turn_state = "in_turn";
        state.snapshot.last_meaningful_progress_at = at;
        state.snapshot.foreground_tool = undefined;
        state.lastHookToolAt = this.now();
        this.appendEvent(state, at, "session", "hook_post_tool", {
          tool_name: event.tool_name ?? null,
        });
        break;

      case "PostToolUseFailure":
        state.pendingPreToolUse = false;
        state.snapshot.turn_state = "in_turn";
        state.snapshot.foreground_tool = undefined;
        this.appendEvent(state, at, "session", "hook_post_tool_failure", {
          tool_name: event.tool_name ?? null,
          error: event.error ?? null,
          is_interrupt: event.is_interrupt ?? null,
        });
        break;

      case "UserPromptSubmit":
        state.snapshot.turn_state = "in_turn";
        state.snapshot.last_meaningful_progress_at = at;
        this.appendEvent(state, at, "session", "hook_user_prompt", {
          prompt: event.prompt ?? null,
        });
        break;

      case "SessionEnd":
        this.appendEvent(state, at, "session", "hook_session_end", {
          reason: event.reason ?? null,
        });
        break;

      case "SubagentStart":
        state.snapshot.last_meaningful_progress_at = at;
        this.appendEvent(state, at, "session", "hook_subagent_start", {
          agent_id: event.agent_id ?? null,
          agent_type: event.agent_type ?? null,
        });
        break;

      case "SubagentStop":
        this.appendEvent(state, at, "session", "hook_subagent_stop", {
          agent_id: event.agent_id ?? null,
          agent_type: event.agent_type ?? null,
        });
        break;

      case "PreCompact":
        this.appendEvent(state, at, "session", "hook_pre_compact", {
          trigger: event.trigger ?? null,
        });
        break;

      case "PostCompact":
        state.snapshot.last_meaningful_progress_at = at;
        this.appendEvent(state, at, "session", "hook_post_compact", {
          trigger: event.trigger ?? null,
        });
        break;

      default:
        this.appendEvent(state, at, "session", `hook_${event.hook_event_name}`, {});
        break;
    }

    this.updateDerivedStatus(state);
  }

  dispose(): void {
    for (const state of this.terminals.values()) {
      this.stopProcessPolling(state);
      this.stopSessionTracking(state);
    }
  }

  private ensureState(
    terminalId: string,
    registration?: RegisterTerminalInput,
  ): TerminalState {
    const existing = this.terminals.get(terminalId);
    if (existing) return existing;
    const state: TerminalState = {
      id: terminalId,
      events: [],
      nextEventId: 1,
      lastContractKey: null,
      lastHookToolAt: 0,
      lastProcessKey: null,
      pendingPreToolUse: false,
      pendingPreToolUseAt: 0,
      lastTokenTotal: null,
      processPollTimer: null,
      ptyId: registration?.ptyId ?? null,
      sessionFile: null,
      sessionPollTimer: null,
      sessionReadInFlight: false,
      sessionRemainder: "",
      sessionWatcher: null,
      sessionOffset: 0,
      shellPid: registration?.shellPid ?? null,
      snapshot: buildBaseSnapshot(
        registration ?? {
          terminalId,
          worktreePath: "",
        }
      ),
    };
    this.terminals.set(terminalId, state);
    if (state.ptyId !== null) {
      this.ptyToTerminal.set(state.ptyId, terminalId);
    }
    return state;
  }

  private appendEvent(
    state: TerminalState,
    at: string | undefined,
    source: TelemetryEvent["source"],
    kind: string,
    data: Record<string, unknown>,
  ): void {
    const event: TelemetryEvent = {
      id: `${state.snapshot.terminal_id}:${state.nextEventId++}`,
      at: at ?? isoNow(this.now),
      terminal_id: state.snapshot.terminal_id,
      workflow_id: state.snapshot.workflow_id,
      handoff_id: state.snapshot.handoff_id,
      source,
      kind,
      data,
    };
    state.events.push(event);
    if (state.events.length > this.eventLimit) {
      state.events.splice(0, state.events.length - this.eventLimit);
    }
  }

  private probeContractState(handoff: Handoff): ContractState {
    const artifacts = handoff.artifacts;
    if (!artifacts) {
      return {
        resultExists: false,
        doneExists: false,
      };
    }

    const resultExists = fs.existsSync(artifacts.result_file);
    const doneExists = fs.existsSync(artifacts.done_file);
    let resultValid: boolean | undefined;
    let doneValid: boolean | undefined;
    const handoffContract = {
      handoff_id: handoff.id,
      workflow_id: handoff.workflow_id,
      artifacts,
    };

    if (resultExists) {
      try {
        const raw = JSON.parse(fs.readFileSync(artifacts.result_file, "utf-8"));
        validateResultContract(raw, handoffContract);
        resultValid = true;
      } catch {
        resultValid = false;
      }
    }

    if (doneExists) {
      try {
        const raw = JSON.parse(fs.readFileSync(artifacts.done_file, "utf-8"));
        validateDoneMarker(raw, handoffContract);
        doneValid = true;
      } catch {
        doneValid = false;
      }
    }

    return {
      resultExists,
      doneExists,
      resultValid,
      doneValid,
      contractActivityAt: latestIso(
        safeMtime(artifacts.result_file),
        safeMtime(artifacts.done_file),
      ),
    };
  }

  private syncContractState(state: TerminalState): void {
    if (!state.snapshot.repo_path || !state.snapshot.handoff_id) {
      return;
    }

    const handoff = new HandoffManager(state.snapshot.repo_path).load(state.snapshot.handoff_id);
    if (!handoff) {
      return;
    }

    const contract = this.probeContractState(handoff);
    const contractKey = JSON.stringify(contract);
    const previousActivityAt = state.snapshot.contract_activity_at;

    state.snapshot.result_exists = contract.resultExists;
    state.snapshot.done_exists = contract.doneExists;
    state.snapshot.result_valid = contract.resultValid;
    state.snapshot.done_valid = contract.doneValid;
    state.snapshot.contract_activity_at = contract.contractActivityAt;

    if (contractKey !== state.lastContractKey) {
      state.lastContractKey = contractKey;
      if (contract.contractActivityAt) {
        state.snapshot.last_meaningful_progress_at = contract.contractActivityAt;
      }

      if (contract.resultExists) {
        this.appendEvent(state, contract.contractActivityAt, "contract", "result_written", {});
      }
      if (contract.doneExists) {
        this.appendEvent(state, contract.contractActivityAt, "contract", "done_written", {});
      }
      if (contract.resultValid === false || contract.doneValid === false) {
        this.appendEvent(state, contract.contractActivityAt, "contract", "contract_invalid", {
          result_valid: contract.resultValid ?? null,
          done_valid: contract.doneValid ?? null,
        });
      } else if (contract.resultValid || contract.doneValid) {
        this.appendEvent(state, contract.contractActivityAt, "contract", "contract_validated", {
          result_valid: contract.resultValid ?? null,
          done_valid: contract.doneValid ?? null,
        });
      }
    } else if (contract.contractActivityAt && contract.contractActivityAt !== previousActivityAt) {
      state.snapshot.last_meaningful_progress_at = contract.contractActivityAt;
    }
  }

  private updateDerivedStatus(state: TerminalState): void {
    const prev = state.snapshot.derived_status;
    const prevTurn = state.snapshot.turn_state;
    const prevTool = state.snapshot.foreground_tool;

    state.snapshot.derived_status = deriveTelemetryStatus(
      state.snapshot,
      this.now(),
      this.stallThresholdMs,
    );

    if (
      this.onSnapshotChanged &&
      (state.snapshot.derived_status !== prev ||
        state.snapshot.turn_state !== prevTurn ||
        state.snapshot.foreground_tool !== prevTool)
    ) {
      this.onSnapshotChanged(state.id, { ...state.snapshot });
    }
  }

  private startProcessPolling(terminalId: string, shellPid: number): void {
    if (this.processPollIntervalMs <= 0) {
      return;
    }
    const state = this.ensureState(terminalId);
    this.stopProcessPolling(state);
    state.shellPid = shellPid;
    const poll = async () => {
      try {
        const snapshot = await getProcessSnapshot(shellPid);
        this.recordProcessSnapshot(terminalId, {
          descendantProcesses: snapshot.descendantProcesses.map((process) => ({
            pid: process.pid,
            command: process.command,
            cli_type: process.cliType,
          })),
          foregroundTool: snapshot.foregroundTool,
        });
      } catch {
      }
    };
    void poll();
    state.processPollTimer = setInterval(() => {
      void poll();
    }, this.processPollIntervalMs);
  }

  private stopProcessPolling(state: TerminalState): void {
    if (state.processPollTimer) {
      clearInterval(state.processPollTimer);
      state.processPollTimer = null;
    }
  }

  private startSessionTracking(state: TerminalState): void {
    if (!state.sessionFile) return;
    const read = () => {
      void this.readSessionDelta(state);
    };

    state.sessionPollTimer = setInterval(read, this.sessionPollIntervalMs);
    try {
      const directory = path.dirname(state.sessionFile);
      const basename = path.basename(state.sessionFile);
      state.sessionWatcher = fs.watch(directory, (_event, changedFile) => {
        if (changedFile && changedFile !== basename) return;
        read();
      });
    } catch {
      state.sessionWatcher = null;
    }
  }

  private stopSessionTracking(state: TerminalState): void {
    if (state.sessionPollTimer) {
      clearInterval(state.sessionPollTimer);
      state.sessionPollTimer = null;
    }
    state.sessionWatcher?.close();
    state.sessionWatcher = null;
    state.sessionReadInFlight = false;
    state.sessionOffset = 0;
    state.sessionRemainder = "";
  }

  private primeSessionFromTail(state: TerminalState): void {
    if (!state.sessionFile) return;
    try {
      const stat = fs.statSync(state.sessionFile);
      const size = stat.size;
      if (size === 0) return;
      const readStart = Math.max(0, size - this.sessionPrimeBytes);
      const fd = fs.openSync(state.sessionFile, "r");
      const buffer = Buffer.alloc(size - readStart);
      fs.readSync(fd, buffer, 0, size - readStart, readStart);
      fs.closeSync(fd);

      const content = buffer.toString("utf-8");
      let lines = content.split("\n");
      if (readStart > 0 && !content.startsWith("\n")) {
        lines = lines.slice(1);
      }
      const trailing = lines.at(-1) ?? "";
      const completeLines = trailing === "" ? lines : lines.slice(0, -1);
      for (const line of completeLines) {
        if (!line.trim()) continue;
        this.recordSessionTelemetry(
          state.snapshot.terminal_id,
          parseSessionTelemetryLine(line, state.snapshot.provider === "claude" ? "claude" : "codex"),
        );
      }
      state.sessionRemainder = trailing === "" ? "" : trailing;
      state.sessionOffset = size - Buffer.byteLength(state.sessionRemainder, "utf-8");
    } catch {
    }
  }

  private async readSessionDelta(state: TerminalState): Promise<void> {
    if (!state.sessionFile || state.sessionReadInFlight) return;
    if (this.now() - state.lastHookToolAt < 2_000) return;
    state.sessionReadInFlight = true;
    try {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(state.sessionFile);
      } catch {
        return;
      }
      if (stat.size < state.sessionOffset) {
        state.sessionOffset = 0;
        state.sessionRemainder = "";
      }
      if (stat.size === state.sessionOffset) {
        return;
      }

      const byteLength = stat.size - state.sessionOffset;
      const fd = fs.openSync(state.sessionFile, "r");
      const buffer = Buffer.alloc(byteLength);
      fs.readSync(fd, buffer, 0, byteLength, state.sessionOffset);
      fs.closeSync(fd);

      const chunk = `${state.sessionRemainder}${buffer.toString("utf-8")}`;
      const lines = chunk.split("\n");
      state.sessionRemainder = lines.pop() ?? "";
      state.sessionOffset = stat.size - Buffer.byteLength(state.sessionRemainder, "utf-8");

      for (const line of lines) {
        if (!line.trim()) continue;
        this.recordSessionTelemetry(
          state.snapshot.terminal_id,
          parseSessionTelemetryLine(line, state.snapshot.provider === "claude" ? "claude" : "codex"),
        );
      }
    } finally {
      state.sessionReadInFlight = false;
    }
  }

  getManagedSessions(): SessionInfo[] {
    const results: SessionInfo[] = [];
    for (const [_terminalId, state] of this.terminals) {
      const snap = state.snapshot;
      if (!snap.session_id || !snap.session_file) continue;

      const sessionEvents = state.events.filter(e => e.source === "session");
      const startedAt = sessionEvents[0]?.at ?? snap.last_meaningful_progress_at ?? new Date().toISOString();

      results.push({
        sessionId: snap.session_id,
        projectDir: snap.worktree_path,
        filePath: snap.session_file,
        isLive: snap.pty_alive,
        isManaged: true,
        status: this.mapTurnStateToStatus(snap.turn_state, snap.derived_status),
        currentTool: snap.foreground_tool,
        startedAt,
        lastActivityAt: snap.last_meaningful_progress_at ?? new Date().toISOString(),
        messageCount: sessionEvents.length,
        tokenTotal: state.lastTokenTotal ?? 0,
      });
    }
    return results;
  }

  private mapTurnStateToStatus(
    turn: TelemetryTurnState,
    derived: TelemetryDerivedStatus,
  ): SessionInfo["status"] {
    if (derived === "error") return "error";
    if (turn === "tool_running" || turn === "tool_pending") return "tool_running";
    if (turn === "thinking" || turn === "in_turn") return "generating";
    if (turn === "turn_complete") return "turn_complete";
    return "idle";
  }
}
