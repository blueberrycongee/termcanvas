import type { SessionInfo } from "../../shared/sessions";
import type { TerminalTelemetrySnapshot } from "../../shared/telemetry";
import { resolveTerminalWithRuntimeState } from "../stores/terminalRuntimeStateStore";
import type { ProjectData, TerminalData } from "../types/index.ts";

// Three real states. "active" collapses what was "running" + "thinking":
// from the user's POV both are "agent is working, no need to look", so
// splitting them is internal noise. "done" and "idle" are kept separate
// in the model (so freshDone/seen tracking still works) but render the
// same gray — both communicate "no signal needed".
export type CanvasTerminalState =
  | "attention"
  | "active"
  | "done"
  | "idle";

export interface CanvasTerminalItem {
  terminalId: string;
  projectId: string;
  projectName: string;
  worktreeId: string;
  worktreeName: string;
  sessionId?: string;
  sessionFilePath?: string;
  title: string;
  locationLabel: string;
  focused: boolean;
  state: CanvasTerminalState;
  activityAt?: string;
  turnStartedAt?: string;
  currentTool?: string;
  attentionReason?: "error" | "awaiting_input";
}

export interface CanvasTerminalSections {
  focused: CanvasTerminalItem | null;
  attention: CanvasTerminalItem[];
  progress: CanvasTerminalItem[];
  done: CanvasTerminalItem[];
  idle: CanvasTerminalItem[];
}

export interface StatusSummary {
  attention: number;
  running: number;
  freshDone: number;
  done: number;
  idle: number;
}

export interface WorktreeGroup {
  worktreeId: string;
  worktreeName: string;
  worktreePath: string;
  isPrimary: boolean;
  statusSummary: StatusSummary;
  terminals: CanvasTerminalItem[];
}

export interface ProjectGroup {
  projectId: string;
  projectName: string;
  projectPath: string;
  statusSummary: StatusSummary;
  worktrees: WorktreeGroup[];
}

export interface StashedTerminalItem {
  terminalId: string;
  projectId: string;
  worktreeId: string;
  title: string;
  originLabel: string;
  stashedAt?: number;
}

export interface ProjectTreeResult {
  projects: ProjectGroup[];
  stashed: StashedTerminalItem[];
}

const GENERIC_TERMINAL_TITLES =
  /^(terminal|shell|claude|codex|kimi|gemini|opencode|wuu|lazygit|tmux)$/i;

export function isCanvasTerminal(
  terminal: Pick<TerminalData, "minimized" | "stashed">,
): boolean {
  return !terminal.minimized && !terminal.stashed;
}

function collapseWhitespace(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

const VAGUE_TERMS = new Set([
  "看看", "看一下", "这个", "那个", "帮忙", "搞一下", "弄一下",
  "改一下", "修一下", "处理一下",
  "help", "this", "that", "hey", "hi", "ok", "yes", "no",
]);

export function extractIntent(
  raw: string | undefined,
  maxLen = 40,
): string | null {
  if (!raw) return null;
  let text = raw.trim();
  text = text.replace(/```[\s\S]*?```/g, "").trim();
  // Only strip things that look like real file paths (must have 2+ segments
  // and start with . / or a known directory prefix like src/ node_modules/)
  text = text.replace(/(?:\.\.?\/|(?:src|lib|dist|node_modules|packages)\/)\S+/g, "").trim();
  text = text
    .replace(/^(帮我|请你?|麻烦|could you|please)\s*/i, "")
    .trim();
  // Cut at sentence-ending punctuation, Chinese comma, or newline.
  // English comma is excluded (often enumeration, not a sentence break).
  const cut = text.search(/[，.。;；!！?？\n]/);
  if (cut > 0) text = text.slice(0, cut).trim();
  if (text.length > maxLen) {
    text = text.slice(0, maxLen - 1).trimEnd() + "…";
  }
  if (!text || VAGUE_TERMS.has(text)) return null;
  return text;
}

function resolveTerminalTitle(
  terminal: Pick<TerminalData, "customTitle" | "title" | "initialPrompt">,
  worktreeName: string,
  projectName: string,
  provider?: string,
  firstUserPrompt?: string,
): string {
  if (terminal.customTitle) {
    return collapseWhitespace(terminal.customTitle, 40);
  }

  if (terminal.title && !GENERIC_TERMINAL_TITLES.test(terminal.title)) {
    return collapseWhitespace(terminal.title, 40);
  }

  const fromInit = extractIntent(terminal.initialPrompt);
  if (fromInit) return fromInit;

  const fromTelemetry = extractIntent(firstUserPrompt);
  if (fromTelemetry) return fromTelemetry;

  if (provider && provider !== "unknown") {
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  if (terminal.title) {
    return terminal.title.charAt(0).toUpperCase() + terminal.title.slice(1);
  }
  return "Terminal";
}

function deriveStateFromTelemetry(
  telemetry: TerminalTelemetrySnapshot,
): Pick<
  CanvasTerminalItem,
  | "state"
  | "activityAt"
  | "turnStartedAt"
  | "currentTool"
  | "sessionFilePath"
  | "attentionReason"
> {
  const activityAt =
    telemetry.last_meaningful_progress_at ??
    telemetry.last_session_event_at ??
    telemetry.last_output_at ??
    telemetry.last_input_at;
  const turnStartedAt = telemetry.turn_started_at;

  // Attention is reserved for signals that should be visible in the
  // left panel: a real process error, `awaiting_input`, or an exited PTY
  // with a non-zero code. We deliberately do NOT promote
  // `derived_status === "stall_candidate"` to attention — it's a
  // heuristic ("output has been quiet for a while") that fires on slow
  // models, which is the exact false positive we're trying to kill.
  if (
    telemetry.derived_status === "error" ||
    (!telemetry.pty_alive &&
      telemetry.exit_code !== undefined &&
      telemetry.exit_code !== 0)
  ) {
    return {
      state: "attention",
      activityAt,
      turnStartedAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
      attentionReason: "error",
    };
  }

  // Active review area: `awaiting_input` can be explicit (Claude
  // Notification) or heuristic (provider-specific PreToolUse silence
  // timer in telemetry-service.ts). Keep this path easy to audit because
  // false positives here make the left panel show red.
  if (telemetry.turn_state === "awaiting_input") {
    return {
      state: "attention",
      activityAt,
      turnStartedAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
      attentionReason: "awaiting_input",
    };
  }

  if (
    telemetry.turn_state === "tool_running" ||
    telemetry.turn_state === "tool_pending" ||
    telemetry.turn_state === "thinking" ||
    telemetry.turn_state === "in_turn"
  ) {
    return {
      state: "active",
      activityAt,
      turnStartedAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
    };
  }

  if (telemetry.derived_status === "awaiting_contract") {
    return {
      state: "active",
      activityAt,
      turnStartedAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
    };
  }

  if (telemetry.turn_state === "turn_complete") {
    return {
      state: "done",
      activityAt,
      turnStartedAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
    };
  }

  if (telemetry.derived_status === "progressing") {
    return {
      state: "active",
      activityAt,
      turnStartedAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
    };
  }

  return {
    state: "idle",
    activityAt,
    turnStartedAt,
    currentTool: telemetry.foreground_tool,
    sessionFilePath: telemetry.session_file,
  };
}

function deriveStateFromSession(
  session: SessionInfo,
): Pick<
  CanvasTerminalItem,
  "state" | "activityAt" | "currentTool" | "sessionFilePath"
> {
  switch (session.status) {
    case "error":
      return {
        state: "attention",
        activityAt: session.lastActivityAt,
        currentTool: session.currentTool,
        sessionFilePath: session.filePath,
      };
    case "tool_running":
    case "generating":
      return {
        state: "active",
        activityAt: session.lastActivityAt,
        currentTool: session.currentTool,
        sessionFilePath: session.filePath,
      };
    case "turn_complete":
      return {
        state: "done",
        activityAt: session.lastActivityAt,
        currentTool: session.currentTool,
        sessionFilePath: session.filePath,
      };
    default:
      return {
        state: "idle",
        activityAt: session.lastActivityAt,
        currentTool: session.currentTool,
        sessionFilePath: session.filePath,
      };
  }
}

function deriveStateFromTerminal(
  terminal: Pick<TerminalData, "status">,
): Pick<
  CanvasTerminalItem,
  "state" | "activityAt" | "currentTool" | "sessionFilePath"
> {
  switch (terminal.status) {
    case "error":
      return { state: "attention" };
    case "running":
    case "active":
    case "waiting":
      return { state: "active" };
    case "completed":
    case "success":
      return { state: "done" };
    default:
      return { state: "idle" };
  }
}

export function deriveTerminalState(
  terminal: Pick<TerminalData, "status" | "sessionId">,
  telemetry: TerminalTelemetrySnapshot | null | undefined,
  session: SessionInfo | undefined,
): Pick<
  CanvasTerminalItem,
  | "state"
  | "activityAt"
  | "turnStartedAt"
  | "currentTool"
  | "sessionFilePath"
  | "attentionReason"
> {
  if (telemetry) {
    const derived = deriveStateFromTelemetry(telemetry);
    // Race window: Path B (hook:stop-failure → setStatus('error')) may arrive before
    // Path A (telemetry IPC) updates derived_status. Override stale telemetry state.
    if (terminal.status === "error" && derived.state !== "attention") {
      return { ...derived, state: "attention", attentionReason: "error" };
    }
    return derived;
  }

  if (session) {
    return deriveStateFromSession(session);
  }

  return deriveStateFromTerminal(terminal);
}

function computeStatusSummary(
  items: CanvasTerminalItem[],
  seenTerminalIds?: Set<string>,
): StatusSummary {
  const summary: StatusSummary = {
    attention: 0,
    running: 0,
    freshDone: 0,
    done: 0,
    idle: 0,
  };
  for (const item of items) {
    switch (item.state) {
      case "attention":
        summary.attention++;
        break;
      case "active":
        summary.running++;
        break;
      case "done":
        if (seenTerminalIds && seenTerminalIds.has(item.terminalId)) {
          summary.done++;
        } else {
          summary.freshDone++;
        }
        break;
      default:
        summary.idle++;
        break;
    }
  }
  return summary;
}

export function buildProjectTree(
  projects: ProjectData[],
  telemetryByTerminalId: Map<
    string,
    TerminalTelemetrySnapshot | null | undefined
  >,
  sessionsById: Map<string, SessionInfo>,
  seenTerminalIds?: Set<string>,
): ProjectTreeResult {
  const result: ProjectGroup[] = [];
  const stashed: StashedTerminalItem[] = [];

  for (const project of projects) {
    const worktreeGroups: WorktreeGroup[] = [];

    for (const worktree of project.worktrees) {
      const terminals: CanvasTerminalItem[] = [];

      for (const terminal of worktree.terminals) {
        const resolvedTerminal = resolveTerminalWithRuntimeState(terminal);

        if (resolvedTerminal.minimized) {
          continue;
        }

        if (resolvedTerminal.stashed) {
          const title = resolveTerminalTitle(
            resolvedTerminal,
            worktree.name,
            project.name,
            telemetryByTerminalId.get(resolvedTerminal.id)?.provider,
            telemetryByTerminalId.get(resolvedTerminal.id)?.first_user_prompt,
          );
          const originLabel =
            worktree.name === project.name
              ? project.name
              : `${project.name} / ${worktree.name}`;
          stashed.push({
            terminalId: resolvedTerminal.id,
            projectId: project.id,
            worktreeId: worktree.id,
            title,
            originLabel,
            stashedAt: resolvedTerminal.stashedAt,
          });
          continue;
        }

        const telemetry = telemetryByTerminalId.get(resolvedTerminal.id);
        const session = resolvedTerminal.sessionId
          ? sessionsById.get(resolvedTerminal.sessionId)
          : undefined;
        const derived = deriveTerminalState(
          resolvedTerminal,
          telemetry,
          session,
        );
        const title = resolveTerminalTitle(
          resolvedTerminal,
          worktree.name,
          project.name,
          telemetry?.provider,
          telemetry?.first_user_prompt,
        );
        const locationLabel =
          worktree.name === project.name
            ? worktree.name
            : `${project.name} / ${worktree.name}`;

        terminals.push({
          terminalId: resolvedTerminal.id,
          projectId: project.id,
          projectName: project.name,
          worktreeId: worktree.id,
          worktreeName: worktree.name,
          sessionId: resolvedTerminal.sessionId,
          sessionFilePath: derived.sessionFilePath,
          title,
          locationLabel,
          focused: resolvedTerminal.focused,
          state: derived.state,
          activityAt: derived.activityAt,
          turnStartedAt: derived.turnStartedAt,
          currentTool: derived.currentTool,
          attentionReason: derived.attentionReason,
        });
      }

      worktreeGroups.push({
        worktreeId: worktree.id,
        worktreeName: worktree.name,
        worktreePath: worktree.path,
        isPrimary: worktree.isPrimary ?? worktree.path === project.path,
        statusSummary: computeStatusSummary(terminals, seenTerminalIds),
        terminals,
      });
    }

    const allTerminals = worktreeGroups.flatMap((wt) => wt.terminals);

    result.push({
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      statusSummary: computeStatusSummary(allTerminals, seenTerminalIds),
      worktrees: worktreeGroups,
    });
  }

  stashed.sort((a, b) => (b.stashedAt ?? 0) - (a.stashedAt ?? 0));

  return { projects: result, stashed };
}

export function buildCanvasTerminalSections(
  projects: ProjectData[],
  telemetryByTerminalId: Map<
    string,
    TerminalTelemetrySnapshot | null | undefined
  >,
  sessionsById: Map<string, SessionInfo>,
): CanvasTerminalSections {
  let focused: CanvasTerminalItem | null = null;
  const attention: CanvasTerminalItem[] = [];
  const progress: CanvasTerminalItem[] = [];
  const done: CanvasTerminalItem[] = [];
  const idle: CanvasTerminalItem[] = [];

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        const resolvedTerminal = resolveTerminalWithRuntimeState(terminal);

        if (!isCanvasTerminal(resolvedTerminal)) {
          continue;
        }

        const telemetry = telemetryByTerminalId.get(resolvedTerminal.id);
        const session = resolvedTerminal.sessionId
          ? sessionsById.get(resolvedTerminal.sessionId)
          : undefined;
        const derived = deriveTerminalState(
          resolvedTerminal,
          telemetry,
          session,
        );
        const title = resolveTerminalTitle(
          resolvedTerminal,
          worktree.name,
          project.name,
          telemetry?.provider,
          telemetry?.first_user_prompt,
        );
        const locationLabel =
          worktree.name === project.name
            ? worktree.name
            : `${project.name} / ${worktree.name}`;

        const item: CanvasTerminalItem = {
          terminalId: resolvedTerminal.id,
          projectId: project.id,
          projectName: project.name,
          worktreeId: worktree.id,
          worktreeName: worktree.name,
          sessionId: resolvedTerminal.sessionId,
          sessionFilePath: derived.sessionFilePath,
          title,
          locationLabel,
          focused: resolvedTerminal.focused,
          state: derived.state,
          activityAt: derived.activityAt,
          turnStartedAt: derived.turnStartedAt,
          currentTool: derived.currentTool,
          attentionReason: derived.attentionReason,
        };

        if (resolvedTerminal.focused) {
          focused = item;
          continue;
        }

        switch (item.state) {
          case "attention":
            attention.push(item);
            break;
          case "active":
            progress.push(item);
            break;
          case "done":
            done.push(item);
            break;
          default:
            idle.push(item);
            break;
        }
      }
    }
  }

  return {
    focused,
    attention,
    progress,
    done,
    idle,
  };
}
