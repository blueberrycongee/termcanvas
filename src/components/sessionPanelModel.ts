import type { SessionInfo } from "../../shared/sessions";
import type { TerminalTelemetrySnapshot } from "../../shared/telemetry";
import { resolveTerminalWithRuntimeState } from "../stores/terminalRuntimeStateStore";
import type { ProjectData, TerminalData } from "../types/index.ts";

export type CanvasTerminalState =
  | "attention"
  | "running"
  | "thinking"
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
  currentTool?: string;
  attentionReason?: "error" | "stall" | "awaiting_input";
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
  done: number;
  idle: number;
}

export interface WorktreeGroup {
  worktreeId: string;
  worktreeName: string;
  statusSummary: StatusSummary;
  terminals: CanvasTerminalItem[];
}

export interface ProjectGroup {
  projectId: string;
  projectName: string;
  statusSummary: StatusSummary;
  worktrees: WorktreeGroup[];
  flat: boolean;
}

const GENERIC_TERMINAL_TITLES =
  /^(terminal|shell|claude|codex|kimi|gemini|opencode|lazygit|tmux)$/i;

function isCanvasTerminal(
  projectCollapsed: boolean,
  worktreeCollapsed: boolean,
  terminal: Pick<TerminalData, "minimized" | "stashed">,
): boolean {
  return (
    !projectCollapsed &&
    !worktreeCollapsed &&
    !terminal.minimized &&
    !terminal.stashed
  );
}

function collapseWhitespace(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function resolveTerminalTitle(
  terminal: Pick<TerminalData, "customTitle" | "title" | "initialPrompt">,
  worktreeName: string,
  projectName: string,
  provider?: string,
): string {
  const displayTitle = collapseWhitespace(
    terminal.customTitle
      ? `${terminal.customTitle} · ${terminal.title}`
      : terminal.title,
    64,
  );
  const initialPrompt = terminal.initialPrompt
    ? collapseWhitespace(terminal.initialPrompt, 72)
    : "";

  if (displayTitle && !GENERIC_TERMINAL_TITLES.test(displayTitle)) {
    return displayTitle;
  }

  if (initialPrompt) return initialPrompt;
  if (provider && provider !== "unknown") {
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
  if (worktreeName) return worktreeName;
  return projectName;
}

function compareItemsByActivity(
  a: CanvasTerminalItem,
  b: CanvasTerminalItem,
): number {
  const aActivity = a.activityAt ?? "";
  const bActivity = b.activityAt ?? "";
  if (aActivity !== bActivity) {
    return bActivity.localeCompare(aActivity);
  }
  return a.title.localeCompare(b.title);
}

function deriveStateFromTelemetry(
  telemetry: TerminalTelemetrySnapshot,
): Pick<
  CanvasTerminalItem,
  "state" | "activityAt" | "currentTool" | "sessionFilePath" | "attentionReason"
> {
  const activityAt =
    telemetry.last_meaningful_progress_at ??
    telemetry.last_session_event_at ??
    telemetry.last_output_at ??
    telemetry.last_input_at;

  if (
    telemetry.derived_status === "error" ||
    (!telemetry.pty_alive &&
      telemetry.exit_code !== undefined &&
      telemetry.exit_code !== 0)
  ) {
    return {
      state: "attention",
      activityAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
      attentionReason: "error",
    };
  }

  if (telemetry.derived_status === "stall_candidate") {
    return {
      state: "attention",
      activityAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
      attentionReason: "stall",
    };
  }

  // Detect awaiting user interaction: main process sets turn_state
  // to "awaiting_input" after PreToolUse has been pending for ≥5s.
  if (telemetry.turn_state === "awaiting_input") {
    return {
      state: "attention",
      activityAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
      attentionReason: "awaiting_input",
    };
  }

  if (
    telemetry.turn_state === "tool_running" ||
    telemetry.turn_state === "tool_pending"
  ) {
    return {
      state: "running",
      activityAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
    };
  }

  if (
    telemetry.turn_state === "thinking" ||
    telemetry.turn_state === "in_turn"
  ) {
    return {
      state: telemetry.foreground_tool ? "running" : "thinking",
      activityAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
    };
  }

  if (telemetry.turn_state === "turn_complete") {
    return {
      state: "done",
      activityAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
    };
  }

  if (
    telemetry.derived_status === "progressing" ||
    telemetry.derived_status === "awaiting_contract"
  ) {
    return {
      state: telemetry.foreground_tool ? "running" : "thinking",
      activityAt,
      currentTool: telemetry.foreground_tool,
      sessionFilePath: telemetry.session_file,
    };
  }

  return {
    state: "idle",
    activityAt,
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
      return {
        state: "running",
        activityAt: session.lastActivityAt,
        currentTool: session.currentTool,
        sessionFilePath: session.filePath,
      };
    case "generating":
      return {
        state: "thinking",
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
      return { state: "running" };
    case "completed":
    case "success":
      return { state: "done" };
    default:
      return { state: "idle" };
  }
}

function deriveTerminalState(
  terminal: Pick<TerminalData, "status" | "sessionId">,
  telemetry: TerminalTelemetrySnapshot | null | undefined,
  session: SessionInfo | undefined,
): Pick<
  CanvasTerminalItem,
  "state" | "activityAt" | "currentTool" | "sessionFilePath" | "attentionReason"
> {
  if (telemetry) {
    return deriveStateFromTelemetry(telemetry);
  }

  if (session) {
    return deriveStateFromSession(session);
  }

  return deriveStateFromTerminal(terminal);
}

const STATE_PRIORITY: Record<CanvasTerminalState, number> = {
  attention: 0,
  running: 1,
  thinking: 2,
  done: 3,
  idle: 4,
};

function computeStatusSummary(items: CanvasTerminalItem[]): StatusSummary {
  const summary: StatusSummary = {
    attention: 0,
    running: 0,
    done: 0,
    idle: 0,
  };
  for (const item of items) {
    switch (item.state) {
      case "attention":
        summary.attention++;
        break;
      case "running":
      case "thinking":
        summary.running++;
        break;
      case "done":
        summary.done++;
        break;
      default:
        summary.idle++;
        break;
    }
  }
  return summary;
}

function compareByStateThenActivity(
  a: CanvasTerminalItem,
  b: CanvasTerminalItem,
): number {
  const pa = STATE_PRIORITY[a.state];
  const pb = STATE_PRIORITY[b.state];
  if (pa !== pb) return pa - pb;
  return compareItemsByActivity(a, b);
}

function highestPriority(summary: StatusSummary): number {
  if (summary.attention > 0) return 0;
  if (summary.running > 0) return 1;
  if (summary.done > 0) return 3;
  return 4;
}

export function buildProjectTree(
  projects: ProjectData[],
  telemetryByTerminalId: Map<
    string,
    TerminalTelemetrySnapshot | null | undefined
  >,
  sessionsById: Map<string, SessionInfo>,
): ProjectGroup[] {
  const result: ProjectGroup[] = [];

  for (const project of projects) {
    const worktreeGroups: WorktreeGroup[] = [];

    for (const worktree of project.worktrees) {
      const terminals: CanvasTerminalItem[] = [];

      for (const terminal of worktree.terminals) {
        const resolvedTerminal = resolveTerminalWithRuntimeState(terminal);

        if (
          !isCanvasTerminal(
            project.collapsed,
            worktree.collapsed,
            resolvedTerminal,
          )
        ) {
          continue;
        }

        if (resolvedTerminal.focused) {
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
          focused: false,
          state: derived.state,
          activityAt: derived.activityAt,
          currentTool: derived.currentTool,
          attentionReason: derived.attentionReason,
        });
      }

      if (terminals.length === 0) continue;

      terminals.sort(compareByStateThenActivity);

      worktreeGroups.push({
        worktreeId: worktree.id,
        worktreeName: worktree.name,
        statusSummary: computeStatusSummary(terminals),
        terminals,
      });
    }

    if (worktreeGroups.length === 0) continue;

    const allTerminals = worktreeGroups.flatMap((wt) => wt.terminals);

    result.push({
      projectId: project.id,
      projectName: project.name,
      statusSummary: computeStatusSummary(allTerminals),
      worktrees: worktreeGroups,
      flat: worktreeGroups.length === 1,
    });
  }

  result.sort((a, b) => {
    const pa = highestPriority(a.statusSummary);
    const pb = highestPriority(b.statusSummary);
    if (pa !== pb) return pa - pb;
    return a.projectName.localeCompare(b.projectName);
  });

  return result;
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

        if (
          !isCanvasTerminal(
            project.collapsed,
            worktree.collapsed,
            resolvedTerminal,
          )
        ) {
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
          case "running":
          case "thinking":
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

  attention.sort(compareItemsByActivity);
  progress.sort(compareItemsByActivity);
  done.sort(compareItemsByActivity);
  idle.sort(compareItemsByActivity);

  return {
    focused,
    attention,
    progress,
    done,
    idle,
  };
}
