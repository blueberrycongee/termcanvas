import type { SessionInfo } from "../../shared/sessions";
import { getTerminalDisplayTitle } from "../stores/terminalState";
import type { ProjectData } from "../types/index.ts";

export interface CanvasSessionMeta {
  title: string;
  worktreeName: string;
  focused: boolean;
  initialPrompt?: string;
}

export interface SessionSections {
  onCanvas: SessionInfo[];
  recent: SessionInfo[];
  history: SessionInfo[];
}

function isVisibleTerminal(projectCollapsed: boolean, worktreeCollapsed: boolean, terminal: {
  minimized: boolean;
  stashed?: boolean;
  sessionId?: string;
}): boolean {
  return !projectCollapsed && !worktreeCollapsed && !terminal.minimized && !terminal.stashed && !!terminal.sessionId;
}

function statusRank(status: SessionInfo["status"]): number {
  switch (status) {
    case "tool_running":
      return 0;
    case "generating":
      return 1;
    case "error":
      return 2;
    case "idle":
      return 3;
    case "turn_complete":
      return 4;
    default:
      return 5;
  }
}

function compareByActivity(a: SessionInfo, b: SessionInfo): number {
  return b.lastActivityAt.localeCompare(a.lastActivityAt);
}

function compareSessions(
  a: SessionInfo,
  b: SessionInfo,
  canvasSessionMeta: Map<string, CanvasSessionMeta>,
): number {
  const aMeta = canvasSessionMeta.get(a.sessionId);
  const bMeta = canvasSessionMeta.get(b.sessionId);

  if (!!aMeta?.focused !== !!bMeta?.focused) {
    return aMeta?.focused ? -1 : 1;
  }

  const statusDelta = statusRank(a.status) - statusRank(b.status);
  if (statusDelta !== 0) return statusDelta;

  return compareByActivity(a, b);
}

export function collectCanvasSessionMeta(
  projects: ProjectData[],
): Map<string, CanvasSessionMeta> {
  const canvasSessionMeta = new Map<string, CanvasSessionMeta>();

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (!isVisibleTerminal(project.collapsed, worktree.collapsed, terminal)) {
          continue;
        }

        const sessionId = terminal.sessionId!;
        const existing = canvasSessionMeta.get(sessionId);
        if (existing && !terminal.focused) {
          continue;
        }

        canvasSessionMeta.set(sessionId, {
          title: getTerminalDisplayTitle(terminal),
          worktreeName: worktree.name,
          focused: terminal.focused,
          initialPrompt: terminal.initialPrompt,
        });
      }
    }
  }

  return canvasSessionMeta;
}

export function buildSessionSections(
  liveSessions: SessionInfo[],
  historySessions: SessionInfo[],
  canvasSessionMeta: Map<string, CanvasSessionMeta>,
): SessionSections {
  const onCanvasIds = new Set(canvasSessionMeta.keys());
  const onCanvas = [...liveSessions, ...historySessions]
    .filter((session) => onCanvasIds.has(session.sessionId))
    .sort((a, b) => compareSessions(a, b, canvasSessionMeta));
  const recent = liveSessions
    .filter((session) => !onCanvasIds.has(session.sessionId))
    .sort((a, b) => compareSessions(a, b, canvasSessionMeta));
  const history = historySessions
    .filter((session) => !onCanvasIds.has(session.sessionId))
    .sort(compareByActivity);

  return { onCanvas, recent, history };
}
