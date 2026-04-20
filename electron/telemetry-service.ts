import fs from "node:fs";
import path from "node:path";
import { AssignmentManager } from "../hydra/src/assignment/manager.ts";
import type { AssignmentRecord } from "../hydra/src/assignment/types.ts";
import { validateRunResult } from "../hydra/src/protocol.ts";
import { loadWorkbench, type WorkbenchRecord } from "../hydra/src/workflow-store.ts";
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
  TelemetryTaskStatus,
  TelemetryTaskStatusSource,
  TelemetryTurnState,
  TerminalTelemetrySnapshot,
  WorkflowTelemetrySnapshot,
} from "../shared/telemetry.ts";
import type { SessionInfo } from "../shared/sessions.ts";
import {
  CLAUDE_PRE_TOOL_USE_FALLBACK_MS,
  CODEX_PRE_TOOL_USE_AWAITING_INPUT_MS,
  DEFAULT_CLAUDE_STALL_MS,
  DEFAULT_CODEX_STALL_MS,
  DEFAULT_PROCESS_POLL_INTERVAL_MS,
  DEFAULT_SESSION_HEARTBEAT_MS,
  DEFAULT_SESSION_POLL_INTERVAL_MS,
  PRE_TOOL_USE_STALE_RESET_MS,
} from "../shared/lifecycleThresholds.ts";

const DEFAULT_EVENT_LIMIT = 200;

interface ActiveToolCall {
  callId: string;
  toolName?: string;
  eventType: string;
  startedAt: string;
}

interface TerminalState {
  id: string;
  activeToolCalls: Map<string, ActiveToolCall>;
  events: TelemetryEvent[];
  nextEventId: number;
  lastTerminalTurnAtMs: number | null;
  lastContractKey: string | null;
  lastHookToolAt: number;
  lastProcessKey: string | null;
  pendingPreToolUse: boolean;
  pendingPreToolUseAt: number;
  awaitingInputTimer: NodeJS.Timeout | null;
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
  assignmentId?: string;
  repoPath?: string;
  ptyId?: number | null;
  shellPid?: number | null;
}

interface UpdateTerminalInput {
  terminalId: string;
  worktreePath?: string;
  provider?: TelemetryProvider;
  workflowId?: string;
  assignmentId?: string;
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
  resultValid?: boolean;
  contractActivityAt?: string;
}

function isoNow(now: () => number): string {
  return new Date(now()).toISOString();
}

function cloneSnapshot(
  snapshot: TerminalTelemetrySnapshot,
): TerminalTelemetrySnapshot {
  return {
    ...snapshot,
    descendant_processes: snapshot.descendant_processes.map((process) => ({
      ...process,
    })),
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

function isTerminalTurnState(state: TelemetryTurnState): boolean {
  return state === "turn_complete" || state === "turn_aborted";
}

function isActiveTurnState(state: TelemetryTurnState): boolean {
  return (
    state === "thinking" ||
    state === "in_turn" ||
    state === "tool_running" ||
    state === "tool_pending"
  );
}

function isClaudeToolResultEvent(
  event: NormalizedSessionTelemetryEvent,
): boolean {
  return event.event_type === "tool_result" && event.role === "user";
}

function toSessionProvider(
  provider: TelemetryProvider,
): "claude" | "codex" | "wuu" | null {
  if (provider === "claude" || provider === "codex" || provider === "wuu") {
    return provider;
  }
  return null;
}

export function deriveTelemetryStatus(
  snapshot: TerminalTelemetrySnapshot,
  nowMs = Date.now(),
  stallThresholdMs?: number,
  sessionHeartbeatMs = DEFAULT_SESSION_HEARTBEAT_MS,
): TelemetryDerivedStatus {
  const effectiveStallThresholdMs =
    stallThresholdMs ??
    (snapshot.provider === "codex"
      ? DEFAULT_CODEX_STALL_MS
      : DEFAULT_CLAUDE_STALL_MS);

  if (!snapshot.pty_alive) {
    return "exited";
  }

  if (
    snapshot.provider === "unknown" &&
    !snapshot.workflow_id &&
    !snapshot.session_attached
  ) {
    return "idle";
  }

  if (snapshot.turn_state === "turn_complete" && snapshot.last_hook_error) {
    return "error";
  }

  if (
    snapshot.turn_state === "turn_complete" &&
    snapshot.assignment_id &&
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

  // Hard evidence from hooks: tool calls are actively running
  if (snapshot.active_tool_calls > 0) {
    return "progressing";
  }

  if (
    snapshot.turn_state === "thinking" ||
    snapshot.turn_state === "tool_running" ||
    snapshot.turn_state === "tool_pending" ||
    snapshot.turn_state === "awaiting_input" ||
    !!snapshot.foreground_tool
  ) {
    return "progressing";
  }

  // Codex doesn't emit "thinking" — in_turn with an attached session
  // means the model is reasoning between tool calls.  Guard with a
  // recency check so stale sessions (e.g. CLI crashed without Stop
  // hook) don't stay "progressing" forever.
  if (snapshot.turn_state === "in_turn" && snapshot.session_attached) {
    const anchor =
      snapshot.last_session_event_at ?? snapshot.last_meaningful_progress_at;
    if (anchor) {
      const anchorMs = new Date(anchor).getTime();
      if (Number.isFinite(anchorMs) && nowMs - anchorMs <= sessionHeartbeatMs) {
        return "progressing";
      }
    }
  }

  if (
    snapshot.turn_state !== "turn_complete" &&
    snapshot.turn_state !== "turn_aborted" &&
    snapshot.last_session_event_at
  ) {
    const lastSessionEventMs = new Date(
      snapshot.last_session_event_at,
    ).getTime();
    if (
      Number.isFinite(lastSessionEventMs) &&
      nowMs - lastSessionEventMs <= sessionHeartbeatMs
    ) {
      return "progressing";
    }
  }

  if (snapshot.last_meaningful_progress_at) {
    const lastProgressMs = new Date(
      snapshot.last_meaningful_progress_at,
    ).getTime();
    if (
      Number.isFinite(lastProgressMs) &&
      nowMs - lastProgressMs <= effectiveStallThresholdMs
    ) {
      return "progressing";
    }
  }

  // PTY output alone isn't evidence of a stall — a freshly-opened Codex
  // or Claude prints a banner before the user has typed anything, and we
  // shouldn't fire the yellow "attention / stall" badge on a terminal
  // that has never even been asked to do work. For agent terminals,
  // require some signal that the agent actually tried to progress.
  // Shell terminals keep the looser behaviour: their ps descendants
  // reliably bump meaningful_progress, and without that, PTY output is
  // the only stall signal we have.
  const isAgentSnapshot =
    snapshot.provider === "claude" ||
    snapshot.provider === "codex" ||
    snapshot.provider === "wuu";
  const hasAgentActivity =
    !!snapshot.last_session_event_at ||
    snapshot.active_tool_calls > 0 ||
    !!snapshot.last_meaningful_progress_at;
  const stallEligible = !isAgentSnapshot || hasAgentActivity;

  if ((snapshot.last_output_at || snapshot.last_input_at) && stallEligible) {
    return "stall_candidate";
  }

  return "starting";
}

export function deriveTelemetryTaskStatus(
  snapshot: TerminalTelemetrySnapshot,
  nowMs = Date.now(),
  sessionHeartbeatMs = DEFAULT_SESSION_HEARTBEAT_MS,
): { status: TelemetryTaskStatus; source: TelemetryTaskStatusSource } {
  if (snapshot.active_tool_calls > 0) {
    return { status: "running", source: "active_tool_calls" };
  }

  if (
    snapshot.turn_state === "tool_running" ||
    snapshot.turn_state === "tool_pending" ||
    snapshot.turn_state === "thinking" ||
    snapshot.turn_state === "awaiting_input" ||
    snapshot.turn_state === "in_turn"
  ) {
    return { status: "running", source: "turn_state" };
  }

  if (
    snapshot.turn_state === "turn_complete" ||
    snapshot.turn_state === "turn_aborted"
  ) {
    return { status: "idle", source: "turn_state" };
  }

  if (snapshot.session_attached && snapshot.last_session_event_at) {
    const lastSessionEventMs = new Date(
      snapshot.last_session_event_at,
    ).getTime();
    if (
      Number.isFinite(lastSessionEventMs) &&
      nowMs - lastSessionEventMs <= sessionHeartbeatMs
    ) {
      return { status: "running", source: "session_heartbeat" };
    }
  }

  if (!snapshot.pty_alive) {
    return { status: "idle", source: "none" };
  }

  return { status: "unknown", source: "none" };
}

const HEAD_LINES_FOR_FIRST_PROMPT = 40;
const FIRST_PROMPT_MAX_LENGTH = 100;

/**
 * Pattern that matches auto-injected context messages from both Claude Code
 * and Codex (AGENTS.md, environment context, skills, etc.).  These are sent
 * as role:"user" but are not actual user input.
 */
const INJECTED_CONTEXT_PATTERN =
  /^(?:\s*#\s*AGENTS\.md\s|<(?:environment_context|skill|user_instructions|apps_instructions|skills_instructions|plugins_instructions|collaboration_mode|realtime_conversation|system-reminder)[>\s]|\s*<[a-z][\w-]*[\s>]|\[Request interrupted by user)/;

/**
 * Read the head of a session JSONL file and return the first meaningful
 * user prompt text.  Handles both Claude (`{type:"user",message:…}`) and
 * Codex (`{type:"response_item",payload:{type:"message",role:"user",…}}`)
 * formats.  Provider-agnostic: format is detected per line.
 */
function extractFirstUserPrompt(
  filePath: string,
  _provider?: TelemetryProvider,
): string | undefined {
  let lines: string[];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    lines = content.split("\n").slice(0, HEAD_LINES_FOR_FIRST_PROMPT);
  } catch {
    return undefined;
  }

  for (const line of lines) {
    if (!line.trim()) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }

    // Claude format: { type: "user", message: { role: "user", content: ... } }
    if (raw.type === "user") {
      // Skip metadata entries (hook output, IDE context, etc.)
      if (raw.isMeta === true || raw.isCompactSummary === true) continue;
      const message = raw.message as Record<string, unknown> | undefined;
      if (!message) continue;
      const text = extractTextFromMessageContent(message.content);
      if (!text || INJECTED_CONTEXT_PATTERN.test(text)) continue;
      return collapseAndTruncate(text, FIRST_PROMPT_MAX_LENGTH);
    }

    // Codex event_msg format: { type: "event_msg", payload: { type: "user_message", message: "..." } }
    if (raw.type === "event_msg") {
      const payload = raw.payload as Record<string, unknown> | undefined;
      if (
        payload?.type === "user_message" &&
        typeof payload.message === "string" &&
        payload.message.trim()
      ) {
        if (INJECTED_CONTEXT_PATTERN.test(payload.message)) continue;
        return collapseAndTruncate(payload.message, FIRST_PROMPT_MAX_LENGTH);
      }
    }

    // Codex response_item format: { type: "response_item", payload: { type: "message", role: "user", content: [...] } }
    if (raw.type === "response_item") {
      const payload = raw.payload as Record<string, unknown> | undefined;
      if (payload?.type === "message" && payload.role === "user") {
        const text = extractTextFromMessageContent(payload.content);
        if (!text || INJECTED_CONTEXT_PATTERN.test(text)) continue;
        return collapseAndTruncate(text, FIRST_PROMPT_MAX_LENGTH);
      }
    }

    if (raw.role === "user") {
      const text = extractTextFromMessageContent(raw.content);
      if (!text || INJECTED_CONTEXT_PATTERN.test(text)) continue;
      return collapseAndTruncate(text, FIRST_PROMPT_MAX_LENGTH);
    }
  }

  return undefined;
}

function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const entry = block as Record<string, unknown>;
    // Claude: { type: "text", text: "..." }
    if (entry.type === "text" && typeof entry.text === "string")
      return entry.text;
    // Codex: { type: "input_text", text: "..." }
    if (entry.type === "input_text" && typeof entry.text === "string")
      return entry.text;
    if (entry.type === "tool_result") continue;
  }
  return "";
}

function collapseAndTruncate(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildBaseSnapshot(
  input: RegisterTerminalInput,
): TerminalTelemetrySnapshot {
  return {
    terminal_id: input.terminalId,
    worktree_path: input.worktreePath,
    provider: input.provider ?? "unknown",
    workflow_id: input.workflowId,
    assignment_id: input.assignmentId,
    repo_path: input.repoPath,
    session_attached: false,
    session_attach_confidence: "none",
    turn_state: "unknown",
    pty_alive: false,
    shell_pid: null,
    descendant_processes: [],
    active_tool_calls: 0,
    task_status: "unknown",
    task_status_source: "none",
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
  private readonly stallThresholdMs: number | undefined;
  private readonly sessionHeartbeatMs: number;
  private readonly ptyToTerminal = new Map<number, string>();
  private readonly terminals = new Map<string, TerminalState>();
  private readonly onSnapshotChanged?: (
    terminalId: string,
    snapshot: TerminalTelemetrySnapshot,
  ) => void;

  constructor(options?: {
    eventLimit?: number;
    now?: () => number;
    processPollIntervalMs?: number;
    sessionPollIntervalMs?: number;
    sessionPrimeBytes?: number;
    stallThresholdMs?: number;
    sessionHeartbeatMs?: number;
    onSnapshotChanged?: (
      terminalId: string,
      snapshot: TerminalTelemetrySnapshot,
    ) => void;
  }) {
    this.eventLimit = options?.eventLimit ?? DEFAULT_EVENT_LIMIT;
    this.now = options?.now ?? Date.now;
    this.processPollIntervalMs =
      options?.processPollIntervalMs ?? DEFAULT_PROCESS_POLL_INTERVAL_MS;
    this.sessionPollIntervalMs =
      options?.sessionPollIntervalMs ?? DEFAULT_SESSION_POLL_INTERVAL_MS;
    this.sessionPrimeBytes = options?.sessionPrimeBytes ?? 262_144;
    this.stallThresholdMs = options?.stallThresholdMs;
    this.sessionHeartbeatMs =
      options?.sessionHeartbeatMs ?? DEFAULT_SESSION_HEARTBEAT_MS;
    this.onSnapshotChanged = options?.onSnapshotChanged;
  }

  registerTerminal(input: RegisterTerminalInput): TerminalTelemetrySnapshot {
    const state = this.ensureState(input.terminalId, input);
    state.snapshot.worktree_path = input.worktreePath;
    state.snapshot.provider = input.provider ?? state.snapshot.provider;
    state.snapshot.workflow_id = input.workflowId ?? state.snapshot.workflow_id;
    state.snapshot.assignment_id = input.assignmentId ?? state.snapshot.assignment_id;
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
      state.snapshot.shell_pid = input.shellPid;
    }
    return this.getTerminalSnapshot(input.terminalId)!;
  }

  updateTerminal(input: UpdateTerminalInput): TerminalTelemetrySnapshot {
    const state = this.ensureState(input.terminalId);
    if (input.worktreePath !== undefined) {
      state.snapshot.worktree_path = input.worktreePath;
    }
    if (input.provider !== undefined) {
      const previousProvider = state.snapshot.provider;
      const upgradingToAgent =
        previousProvider === "unknown" &&
        (input.provider === "claude" ||
          input.provider === "codex" ||
          input.provider === "wuu");
      state.snapshot.provider = input.provider;
      if (upgradingToAgent) {
        // Between terminal creation (provider "unknown") and CLI
        // detection upgrading us to an agent type, ps-driven state
        // treats the terminal like a shell: descendant churn bumps
        // last_meaningful_progress_at, and the descendant command
        // leaks into foreground_tool. Once we realise this is an
        // agent, those values are noise — they reflect the agent's
        // infrastructure booting up (MCP daemons, shell wrapper
        // process), not the agent doing work. Leaving them in place
        // persistently traps derived_status in "progressing" even
        // when the agent never received a prompt. Reset them so the
        // agent lifecycle starts from a clean slate and only real
        // signals (session events, hooks) can promote it back to
        // active states.
        state.snapshot.last_meaningful_progress_at = undefined;
        state.snapshot.foreground_tool = undefined;
      }
    }
    state.snapshot.workflow_id = input.workflowId ?? state.snapshot.workflow_id;
    state.snapshot.assignment_id = input.assignmentId ?? state.snapshot.assignment_id;
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
      state.snapshot.shell_pid = input.shellPid;
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
    state.snapshot.shell_pid = state.shellPid;
    state.activeToolCalls.clear();
    state.lastTerminalTurnAtMs = null;
    state.snapshot.pty_alive = true;
    state.snapshot.exit_code = undefined;
    state.snapshot.active_tool_calls = 0;
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
    this.appendEvent(state, timestamp, "pty", "pty_input", {
      bytes: data.length,
    });
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
    this.appendEvent(state, timestamp, "pty", "pty_output", {
      bytes: data.length,
    });
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
    state.activeToolCalls.clear();
    state.lastTerminalTurnAtMs = null;
    state.snapshot.pty_alive = false;
    state.snapshot.exit_code = exitCode;
    state.snapshot.active_tool_calls = 0;
    state.snapshot.foreground_tool = undefined;
    this.stopProcessPolling(state);
    this.appendEvent(state, timestamp, "pty", "pty_exit", {
      exit_code: exitCode,
    });
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
    const firstAttach = !state.snapshot.session_attached;
    state.snapshot.provider = input.provider;
    state.snapshot.session_attached = true;
    state.snapshot.session_attach_confidence = input.confidence;
    state.snapshot.session_id = input.sessionId;
    state.snapshot.session_file = input.sessionFile;
    if (firstAttach) {
      // Until this moment we didn't know the terminal was a real agent,
      // so ps-driven state treated it like a shell: any descendant
      // churn between terminal creation and session-attach bumped
      // last_meaningful_progress_at, and the descendant command leaked
      // into foreground_tool. Those values are infrastructure noise
      // (shell wrapper, MCP daemons booting, CLI banner output), not
      // agent work. Clear them so derived_status starts clean the
      // instant we recognise this as an agent session; real work will
      // refill them through primeSessionFromTail / future session
      // events / hook events.
      state.snapshot.last_meaningful_progress_at = undefined;
      state.snapshot.foreground_tool = undefined;
    }
    this.appendEvent(state, timestamp, "session", "session_attached", {
      provider: input.provider,
      session_id: input.sessionId,
      session_attach_confidence: input.confidence,
      session_file: input.sessionFile ?? null,
    });
    this.updateDerivedStatus(state);
  }

  attachSessionSource(input: SessionAttachInput): void {
    const state = this.ensureState(input.terminalId);
    const sessionChanged =
      state.snapshot.session_id !== input.sessionId ||
      state.snapshot.session_file !== input.sessionFile;

    this.recordSessionAttached(input);
    this.stopSessionTracking(state);
    state.sessionFile = input.sessionFile ?? null;
    state.sessionOffset = 0;
    state.sessionRemainder = "";
    if (sessionChanged) {
      state.snapshot.first_user_prompt = undefined;
    }
    if (!state.sessionFile) {
      return;
    }
    this.primeSessionFromTail(state);
    this.startSessionTracking(state);

    // Extract first user prompt for display in the session panel title.
    const prompt = extractFirstUserPrompt(state.sessionFile);
    if (prompt) {
      state.snapshot.first_user_prompt = prompt;
    }
  }

  recordSessionAttachFailed(
    terminalId: string,
    reason: string,
    at?: string,
  ): void {
    const state = this.ensureState(terminalId);
    const timestamp = at ?? isoNow(this.now);
    this.appendEvent(state, timestamp, "session", "session_attach_failed", {
      reason,
    });
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
      const eventAtMs = new Date(timestamp).getTime();
      const previousTurnState = state.snapshot.turn_state;
      state.snapshot.last_session_event_at = timestamp;
      state.snapshot.last_session_event_kind = event.event_type;

      if (event.call_id && event.lifecycle) {
        state.snapshot.last_tool_event_at = timestamp;
        if (event.lifecycle === "start") {
          state.activeToolCalls.set(event.call_id, {
            callId: event.call_id,
            toolName: event.tool_name,
            eventType: event.event_type,
            startedAt: timestamp,
          });
          if (!state.pendingPreToolUse && event.tool_name) {
            state.snapshot.foreground_tool = event.tool_name;
          }
        } else if (event.lifecycle === "end") {
          state.activeToolCalls.delete(event.call_id);
          if (!state.pendingPreToolUse && state.activeToolCalls.size === 0) {
            state.snapshot.foreground_tool = undefined;
          }
        }
      }
      state.snapshot.active_tool_calls = state.activeToolCalls.size;

      if (
        state.snapshot.provider === "claude" &&
        state.pendingPreToolUse &&
        isClaudeToolResultEvent(event)
      ) {
        // Claude only writes `tool_result` after the approval gate is
        // past and the tool has returned (or been launched async). If
        // PostToolUse never arrives, this session event is still
        // authoritative enough to retire the pending PreToolUse state.
        state.pendingPreToolUse = false;
        state.snapshot.pending_tool_use_at = undefined;
        if (state.awaitingInputTimer) {
          clearTimeout(state.awaitingInputTimer);
          state.awaitingInputTimer = null;
        }
        if (
          state.activeToolCalls.size === 0 &&
          event.turn_state !== "tool_running"
        ) {
          state.snapshot.foreground_tool = undefined;
        }
      }

      if (event.turn_state) {
        // Preserve awaiting_input set by the PreToolUse fallback timer
        // — late-arriving JSONL events written before the permission
        // dialog showed up would otherwise clobber the state with a
        // stale `in_turn` / `tool_running`.
        //
        // BUT: terminal turn states (`turn_complete` / `turn_aborted`)
        // are always authoritative. If the session JSONL says the
        // turn ended, any PreToolUse we had queued is moot — the hook
        // pipeline may have missed a PostToolUse (Codex path: user
        // declined exec approval, Codex kept reasoning, never fired
        // PostToolUse; Stop hook racy or absent). Without this escape
        // hatch the tile sits at red `awaiting_input` until the 5-
        // minute `PRE_TOOL_USE_STALE_RESET_MS` safety net clears it.
        const preserveAwaitingInput =
          state.pendingPreToolUse &&
          state.snapshot.turn_state === "awaiting_input" &&
          !isTerminalTurnState(event.turn_state);
        const preserveTerminalTurnState =
          isTerminalTurnState(state.snapshot.turn_state) &&
          isActiveTurnState(event.turn_state) &&
          state.lastTerminalTurnAtMs !== null &&
          Number.isFinite(eventAtMs) &&
          eventAtMs <= state.lastTerminalTurnAtMs;
        if (!preserveAwaitingInput && !preserveTerminalTurnState) {
          state.snapshot.turn_state = event.turn_state;
          if (
            isTerminalTurnState(event.turn_state) &&
            Number.isFinite(eventAtMs)
          ) {
            state.lastTerminalTurnAtMs = eventAtMs;
            // The turn is over per JSONL; anything the hook pipeline
            // left half-open (pendingPreToolUse + its fallback timer,
            // pending_tool_use_at) will never get reconciled by a
            // hook because the turn won't emit more hooks. Clean up
            // now so the next render matches the authoritative "turn
            // ended" state.
            if (state.pendingPreToolUse) {
              state.pendingPreToolUse = false;
              state.snapshot.pending_tool_use_at = undefined;
              if (state.awaitingInputTimer) {
                clearTimeout(state.awaitingInputTimer);
                state.awaitingInputTimer = null;
              }
            }
          }
        }
      }

      let meaningfulProgress = event.meaningful_progress === true;
      if (
        event.event_type === "token_count" &&
        typeof event.token_total === "number"
      ) {
        if (
          state.lastTokenTotal === null ||
          event.token_total > state.lastTokenTotal
        ) {
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
        call_id: event.call_id ?? null,
        lifecycle: event.lifecycle ?? null,
        active_tool_calls: state.snapshot.active_tool_calls,
        token_total: event.token_total ?? null,
        raw_ref: event.raw_ref ?? null,
      });

      if (
        event.turn_state &&
        state.snapshot.turn_state === event.turn_state &&
        event.turn_state !== previousTurnState
      ) {
        // Track when a turn begins for elapsed-time display
        const enteringTurn = isActiveTurnState(event.turn_state);
        const wasTurnComplete =
          previousTurnState === "turn_complete" ||
          previousTurnState === "turn_aborted" ||
          previousTurnState === "unknown";
        if (enteringTurn && wasTurnComplete) {
          state.snapshot.turn_started_at = timestamp;
        }
        if (
          event.turn_state === "turn_complete" ||
          event.turn_state === "turn_aborted"
        ) {
          state.snapshot.turn_started_at = undefined;
        }

        this.appendEvent(
          state,
          timestamp,
          "session",
          "session_turn_state_changed",
          {
            from: previousTurnState,
            to: event.turn_state,
          },
        );
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
    state.snapshot.descendant_processes = snapshot.descendantProcesses.map(
      (process) => ({
        ...process,
      }),
    );

    // Deciding what to do with the process-derived foreground_tool is
    // subtle because agents (claude/codex/wuu) and plain shell terminals
    // want opposite behaviour:
    //
    //   - Shell terminals have no hook / session signal, so the
    //     descendant process tree IS the primary source of truth for
    //     "which tool is the user currently running". We keep that.
    //
    //   - Agent terminals get their authoritative foreground_tool from
    //     hooks (PreToolUse → tool_name) or from session events. Outside
    //     of an actual tool call, descendant processes are long-lived
    //     infrastructure (MCP servers like playwright-mcp, and the
    //     Chromium children they spawn) that aren't tools the agent is
    //     running — but they'd pollute the session panel into a perma-
    //     "running <mcp>" yellow state otherwise.
    const provider = state.snapshot.provider;
    const isAgentTerminal =
      provider === "claude" || provider === "codex" || provider === "wuu";
    const hasActiveHookTool = state.pendingPreToolUse;
    const hasActiveSessionTool =
      state.activeToolCalls.size > 0 ||
      state.snapshot.turn_state === "tool_running" ||
      state.snapshot.turn_state === "tool_pending";

    if (hasActiveHookTool) {
      // Hook already knows the exact tool name; ps data is noisier and
      // can't improve on it. Only intervene on the stale-recovery path.
      if (this.now() - state.pendingPreToolUseAt > PRE_TOOL_USE_STALE_RESET_MS) {
        console.warn(
          `[Telemetry] Resetting stale pendingPreToolUse for terminal=${terminalId} (>5min without PostToolUse)`,
        );
        state.pendingPreToolUse = false;
        state.snapshot.pending_tool_use_at = undefined;
        state.snapshot.turn_state = "unknown";
        state.snapshot.foreground_tool = snapshot.foregroundTool ?? undefined;
        if (state.awaitingInputTimer) {
          clearTimeout(state.awaitingInputTimer);
          state.awaitingInputTimer = null;
        }
      }
    } else if (!isAgentTerminal) {
      // Plain shell — ps is the only signal we have.
      state.snapshot.foreground_tool = snapshot.foregroundTool ?? undefined;
    } else if (hasActiveSessionTool) {
      // Agent, session says a tool is running, hook has not claimed one.
      // ps-derived tool name fills the gap (e.g. hook-less agent flows).
      state.snapshot.foreground_tool = snapshot.foregroundTool ?? undefined;
    } else {
      // Agent, idle: descendants are daemons (MCP servers etc). Drop
      // anything ps might have picked up so the panel doesn't invent a
      // running tool where there isn't one.
      state.snapshot.foreground_tool = undefined;
    }

    // Whether ps churn counts as "meaningful progress" depends on the
    // same gate as foreground_tool. A shell's descendant processes ARE
    // the signal, but an agent's descendants (MCP servers spawning
    // their own children, Playwright's Chromium tree churning, etc.)
    // would otherwise keep `last_meaningful_progress_at` refreshed
    // forever, which feeds derived_status="progressing" and paints the
    // panel green "thinking" on a freshly opened Codex that literally
    // hasn't been asked to do anything. Genuine agent work still gets
    // tracked through session events and hook-set timestamps — those
    // don't flow through this branch.
    const processChangeCountsAsProgress =
      !isAgentTerminal || hasActiveHookTool || hasActiveSessionTool;
    if (hasMeaningfulChange && processChangeCountsAsProgress) {
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

  getWorkflowSnapshot(
    repoPath: string,
    workflowId: string,
  ): WorkflowTelemetrySnapshot | null {
    const workflow = loadWorkbench(repoPath, workflowId);
    if (!workflow) return null;

    // Find the currently dispatched node's assignment
    const dispatchedNodeId = Object.entries(workflow.node_statuses ?? {})
      .find(([, s]) => s === "dispatched")?.[0];
    const assignmentId = dispatchedNodeId
      ? workflow.nodes?.[dispatchedNodeId]?.assignment_id
      : workflow.assignment_ids?.[workflow.assignment_ids.length - 1];
    if (!assignmentId) return null;

    const assignment = new AssignmentManager(repoPath, workflowId).load(assignmentId);
    if (!assignment) return null;

    const run = assignment.active_run_id
      ? assignment.runs.find((r) => r.id === assignment.active_run_id)
      : assignment.runs[assignment.runs.length - 1];
    const terminalId = run?.terminal_id ?? null;
    const terminal = terminalId ? this.getTerminalSnapshot(terminalId) : null;
    const contract = this.probeContractState(assignment, workflowId);
    const lastMeaningfulProgressAt = latestIso(
      terminal?.last_meaningful_progress_at,
      contract.contractActivityAt,
    );

    const startedAt = run?.started_at ?? workflow.updated_at;
    const startedMs = new Date(startedAt).getTime();
    const timeoutMinutes = assignment.timeout_minutes ?? workflow.default_timeout_minutes;
    const deadlineMs =
      Number.isFinite(startedMs) && typeof timeoutMinutes === "number"
        ? startedMs + timeoutMinutes * 60_000
        : undefined;

    return {
      workflow_id: workflow.id,
      repo_path: workflow.repo_path,
      workflow_status: workflow.status,
      current_assignment_id: assignment.id,
      terminal_id: terminalId,
      terminal,
      contract: {
        result_exists: contract.resultExists,
        result_valid: contract.resultValid,
        contract_activity_at: contract.contractActivityAt,
      },
      last_meaningful_progress_at: lastMeaningfulProgressAt,
      retry_budget: {
        used: assignment.retry_count,
        max: assignment.max_retries,
        remaining: Math.max(0, assignment.max_retries - assignment.retry_count),
      },
      timeout_budget: {
        minutes: timeoutMinutes,
        started_at: startedAt,
        deadline_at: deadlineMs ? new Date(deadlineMs).toISOString() : undefined,
        remaining_ms: deadlineMs !== undefined ? Math.max(0, deadlineMs - this.now()) : undefined,
      },
      advisory_status: terminal?.derived_status ?? "unavailable",
    };
  }

  recordHookEvent(
    terminalId: string,
    event: {
      hook_event_name: string;
      session_id?: string;
      transcript_path?: string;
      cwd?: string;
      [key: string]: unknown;
    },
  ): void {
    const state = this.ensureState(terminalId);
    const at = isoNow(this.now);

    switch (event.hook_event_name) {
      case "SessionStart":
        if (event.session_id) {
          const provider = state.snapshot.provider || "claude";
          this.recordSessionAttached({
            terminalId,
            provider,
            sessionId: event.session_id as string,
            confidence: "strong",
            sessionFile: (event.transcript_path as string) ?? undefined,
          });
          if (event.transcript_path) {
            this.attachSessionSource({
              terminalId,
              provider,
              sessionId: event.session_id as string,
              confidence: "strong",
              sessionFile: event.transcript_path as string,
            });
          }
        }
        state.snapshot.last_hook_error = undefined;
        state.snapshot.last_hook_error_details = undefined;
        state.snapshot.turn_started_at = at;
        this.appendEvent(state, at, "session", "hook_session_start", {
          session_id: event.session_id ?? null,
          source: event.source ?? null,
          model: event.model ?? null,
        });
        break;

      case "Stop":
        if (state.awaitingInputTimer) {
          clearTimeout(state.awaitingInputTimer);
          state.awaitingInputTimer = null;
        }
        state.pendingPreToolUse = false;
        state.snapshot.pending_tool_use_at = undefined;
        state.activeToolCalls.clear();
        state.lastTerminalTurnAtMs = this.now();
        state.snapshot.active_tool_calls = 0;
        state.snapshot.foreground_tool = undefined;
        state.snapshot.last_hook_error = undefined;
        state.snapshot.last_hook_error_details = undefined;
        state.snapshot.turn_state = "turn_complete";
        state.snapshot.turn_started_at = undefined;
        state.snapshot.last_meaningful_progress_at = at;
        this.appendEvent(state, at, "session", "hook_stop", {
          last_assistant_message: event.last_assistant_message ?? null,
        });
        break;

      case "StopFailure":
        if (state.awaitingInputTimer) {
          clearTimeout(state.awaitingInputTimer);
          state.awaitingInputTimer = null;
        }
        state.pendingPreToolUse = false;
        state.snapshot.pending_tool_use_at = undefined;
        state.activeToolCalls.clear();
        state.lastTerminalTurnAtMs = this.now();
        state.snapshot.active_tool_calls = 0;
        state.snapshot.foreground_tool = undefined;
        state.snapshot.turn_state = "turn_complete";
        state.snapshot.turn_started_at = undefined;
        state.snapshot.last_hook_error =
          typeof event.error === "string" ? event.error : "unknown";
        state.snapshot.last_hook_error_details =
          typeof event.error_details === "string"
            ? event.error_details
            : undefined;
        this.appendEvent(state, at, "session", "hook_stop_failure", {
          error: event.error ?? null,
          error_details: event.error_details ?? null,
          last_assistant_message: event.last_assistant_message ?? null,
        });
        break;

      case "PreToolUse": {
        if (state.pendingPreToolUse) {
          console.warn(
            `[Telemetry] Missed PostToolUse for terminal=${terminalId} (new PreToolUse arrived while pending)`,
          );
        }
        if (state.awaitingInputTimer) {
          clearTimeout(state.awaitingInputTimer);
        }
        state.pendingPreToolUse = true;
        state.pendingPreToolUseAt = this.now();
        state.snapshot.pending_tool_use_at = at;
        state.snapshot.active_tool_calls = 1;
        state.snapshot.turn_state = "tool_running";
        state.snapshot.last_meaningful_progress_at = at;
        state.snapshot.foreground_tool = event.tool_name as string | undefined;
        state.lastHookToolAt = this.now();
        // Provider-specific fallback timer. For Claude Code the primary
        // signal is the Notification hook (see below); for Codex there is
        // no approval hook, so the timer is the heuristic we rely on.
        const fallbackMs =
          state.snapshot.provider === "codex"
            ? CODEX_PRE_TOOL_USE_AWAITING_INPUT_MS
            : CLAUDE_PRE_TOOL_USE_FALLBACK_MS;
        state.awaitingInputTimer = setTimeout(() => {
          state.awaitingInputTimer = null;
          if (state.pendingPreToolUse) {
            state.snapshot.turn_state = "awaiting_input";
            this.updateDerivedStatus(state, { force: true });
          }
        }, fallbackMs);
        this.appendEvent(state, at, "session", "hook_pre_tool", {
          tool_name: event.tool_name ?? null,
        });
        break;
      }

      case "Notification": {
        // Claude Code's Notification hook is the authoritative signal
        // that the user's attention is required — it fires for both
        // tool-permission prompts and for "Claude has been idle waiting
        // for your input". Flipping turn_state lets the pet react
        // instantly instead of after the PreToolUse fallback window.
        //
        // Codex does not emit this hook, so Codex paths never reach
        // here; it relies on the PreToolUse fallback timer instead.
        const message =
          typeof event.message === "string" ? event.message : undefined;
        if (state.awaitingInputTimer) {
          clearTimeout(state.awaitingInputTimer);
          state.awaitingInputTimer = null;
        }
        state.snapshot.turn_state = "awaiting_input";
        state.snapshot.last_meaningful_progress_at = at;
        this.appendEvent(state, at, "session", "hook_notification", {
          message: message ?? null,
        });
        this.updateDerivedStatus(state, { force: true });
        break;
      }

      case "PostToolUse":
        if (state.awaitingInputTimer) {
          clearTimeout(state.awaitingInputTimer);
          state.awaitingInputTimer = null;
        }
        state.pendingPreToolUse = false;
        state.snapshot.pending_tool_use_at = undefined;
        state.snapshot.active_tool_calls = 0;
        state.snapshot.turn_state = "in_turn";
        state.snapshot.last_meaningful_progress_at = at;
        state.snapshot.foreground_tool = undefined;
        state.lastHookToolAt = this.now();
        this.appendEvent(state, at, "session", "hook_post_tool", {
          tool_name: event.tool_name ?? null,
        });
        break;

      case "PostToolUseFailure":
        if (state.awaitingInputTimer) {
          clearTimeout(state.awaitingInputTimer);
          state.awaitingInputTimer = null;
        }
        state.pendingPreToolUse = false;
        state.snapshot.pending_tool_use_at = undefined;
        state.snapshot.active_tool_calls = 0;
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
        state.snapshot.turn_started_at = at;
        state.snapshot.last_meaningful_progress_at = at;
        this.appendEvent(state, at, "session", "hook_user_prompt", {
          prompt: event.prompt ?? null,
        });
        break;

      case "SessionEnd":
        if (state.awaitingInputTimer) {
          clearTimeout(state.awaitingInputTimer);
          state.awaitingInputTimer = null;
        }
        state.pendingPreToolUse = false;
        state.snapshot.pending_tool_use_at = undefined;
        state.activeToolCalls.clear();
        state.snapshot.active_tool_calls = 0;
        state.snapshot.foreground_tool = undefined;
        // If the session ends while we were still flagged
        // `awaiting_input` (timer fired before a tool completed, then
        // the session wrapped without Stop/PostToolUse), that signal
        // is now stale — no user approval is reachable with the
        // session gone. Drive the turn state to a terminal value so
        // the session panel drops the red attention badge.
        if (state.snapshot.turn_state === "awaiting_input") {
          state.snapshot.turn_state = "turn_aborted";
          state.lastTerminalTurnAtMs = this.now();
        }
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
        this.appendEvent(
          state,
          at,
          "session",
          `hook_${event.hook_event_name}`,
          {},
        );
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
      activeToolCalls: new Map<string, ActiveToolCall>(),
      events: [],
      nextEventId: 1,
      lastTerminalTurnAtMs: null,
      lastContractKey: null,
      lastHookToolAt: 0,
      lastProcessKey: null,
      pendingPreToolUse: false,
      pendingPreToolUseAt: 0,
      awaitingInputTimer: null,
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
        },
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
      assignment_id: state.snapshot.assignment_id,
      source,
      kind,
      data,
    };
    state.events.push(event);
    if (state.events.length > this.eventLimit) {
      state.events.splice(0, state.events.length - this.eventLimit);
    }
  }

  private probeContractState(assignment: AssignmentRecord, workflowId: string): ContractState {
    const run = assignment.active_run_id
      ? assignment.runs.find((r) => r.id === assignment.active_run_id)
      : assignment.runs[assignment.runs.length - 1];
    if (!run) {
      return { resultExists: false };
    }

    const resultExists = fs.existsSync(run.result_file);
    let resultValid: boolean | undefined;

    if (resultExists) {
      try {
        const raw = JSON.parse(fs.readFileSync(run.result_file, "utf-8"));
        validateRunResult(raw, {
          workbench_id: workflowId,
          assignment_id: assignment.id,
          run_id: run.id,
        });
        resultValid = true;
      } catch {
        resultValid = false;
      }
    }

    return {
      resultExists,
      resultValid,
      contractActivityAt: safeMtime(run.result_file),
    };
  }

  private syncContractState(state: TerminalState): void {
    if (!state.snapshot.repo_path || !state.snapshot.assignment_id || !state.snapshot.workflow_id) {
      return;
    }

    const assignment = new AssignmentManager(
      state.snapshot.repo_path, state.snapshot.workflow_id,
    ).load(state.snapshot.assignment_id);
    if (!assignment) return;

    const contract = this.probeContractState(assignment, state.snapshot.workflow_id);
    const contractKey = JSON.stringify(contract);
    const previousActivityAt = state.snapshot.contract_activity_at;

    state.snapshot.result_exists = contract.resultExists;
    state.snapshot.result_valid = contract.resultValid;
    state.snapshot.contract_activity_at = contract.contractActivityAt;

    if (contractKey !== state.lastContractKey) {
      state.lastContractKey = contractKey;
      if (contract.contractActivityAt) {
        state.snapshot.last_meaningful_progress_at = contract.contractActivityAt;
      }

      if (contract.resultExists) {
        this.appendEvent(state, contract.contractActivityAt, "contract", "result_written", {});
      }
      if (contract.resultValid === false) {
        this.appendEvent(state, contract.contractActivityAt, "contract", "contract_invalid", {
          result_valid: false,
        });
      } else if (contract.resultValid) {
        this.appendEvent(state, contract.contractActivityAt, "contract", "contract_validated", {
          result_valid: true,
        });
      }
    } else if (
      contract.contractActivityAt &&
      contract.contractActivityAt !== previousActivityAt
    ) {
      state.snapshot.last_meaningful_progress_at = contract.contractActivityAt;
    }
  }

  private updateDerivedStatus(
    state: TerminalState,
    options?: { force?: boolean },
  ): void {
    const prev = state.snapshot.derived_status;
    const prevTurn = state.snapshot.turn_state;
    const prevTool = state.snapshot.foreground_tool;
    const prevTaskStatus = state.snapshot.task_status;
    const prevTaskStatusSource = state.snapshot.task_status_source;

    const taskStatus = deriveTelemetryTaskStatus(
      state.snapshot,
      this.now(),
      this.sessionHeartbeatMs,
    );
    state.snapshot.task_status = taskStatus.status;
    state.snapshot.task_status_source = taskStatus.source;

    state.snapshot.derived_status = deriveTelemetryStatus(
      state.snapshot,
      this.now(),
      this.stallThresholdMs,
      this.sessionHeartbeatMs,
    );

    if (
      this.onSnapshotChanged &&
      (options?.force ||
        state.snapshot.derived_status !== prev ||
        state.snapshot.turn_state !== prevTurn ||
        state.snapshot.foreground_tool !== prevTool ||
        state.snapshot.task_status !== prevTaskStatus ||
        state.snapshot.task_status_source !== prevTaskStatusSource)
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
    state.snapshot.shell_pid = shellPid;
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
      } catch {}
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
        const provider = toSessionProvider(state.snapshot.provider);
        if (!provider) continue;
        this.recordSessionTelemetry(
          state.snapshot.terminal_id,
          parseSessionTelemetryLine(
            line,
            provider,
          ),
        );
      }
      state.sessionRemainder = trailing === "" ? "" : trailing;
      state.sessionOffset =
        size - Buffer.byteLength(state.sessionRemainder, "utf-8");
    } catch {}
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
      state.sessionOffset =
        stat.size - Buffer.byteLength(state.sessionRemainder, "utf-8");

      for (const line of lines) {
        if (!line.trim()) continue;
        const provider = toSessionProvider(state.snapshot.provider);
        if (!provider) continue;
        this.recordSessionTelemetry(
          state.snapshot.terminal_id,
          parseSessionTelemetryLine(
            line,
            provider,
          ),
        );
      }

      // Retry first-user-prompt extraction if the initial attempt
      // during attachSessionSource missed it (e.g. file was empty).
      if (!state.snapshot.first_user_prompt && state.sessionFile) {
        const prompt = extractFirstUserPrompt(
          state.sessionFile,
          state.snapshot.provider,
        );
        if (prompt) {
          state.snapshot.first_user_prompt = prompt;
        }
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

      const sessionEvents = state.events.filter((e) => e.source === "session");
      const startedAt =
        sessionEvents[0]?.at ??
        snap.last_meaningful_progress_at ??
        new Date().toISOString();

      results.push({
        sessionId: snap.session_id,
        projectDir: snap.worktree_path,
        filePath: snap.session_file,
        isLive: snap.pty_alive,
        isManaged: true,
        status: this.mapTurnStateToStatus(snap.turn_state, snap.derived_status),
        currentTool: snap.foreground_tool,
        startedAt,
        lastActivityAt:
          snap.last_meaningful_progress_at ?? new Date().toISOString(),
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
    if (turn === "tool_running" || turn === "tool_pending")
      return "tool_running";
    if (turn === "thinking" || turn === "in_turn") {
      // Only report "generating" when derived status confirms the agent is
      // actively progressing.  Stale turn_state (e.g. from a previous session
      // that didn't fire a Stop hook) should not show as "Thinking".
      return derived === "progressing" ? "generating" : "idle";
    }
    if (turn === "turn_complete") return "turn_complete";
    return "idle";
  }
}
