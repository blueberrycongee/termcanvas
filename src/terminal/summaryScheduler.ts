import type { TerminalData } from "../types/index.ts";
import { useProjectStore } from "../stores/projectStore";
import { usePreferencesStore } from "../stores/preferencesStore";

type SummaryCli = "claude" | "codex";

const SUMMARY_ELIGIBLE_TYPES = new Set(["claude", "codex"]);
const AUTO_SUMMARY_INTERVAL_MS = 30_000;

const inFlightRenderer = new Set<string>();
const lastSummaryTimestamp = new Map<string, number>();

export function requestSummary(
  projectId: string,
  worktreeId: string,
  worktreePath: string,
  terminal: TerminalData,
  summaryCli: SummaryCli,
): void {
  if (!SUMMARY_ELIGIBLE_TYPES.has(terminal.type)) return;
  if (!terminal.sessionId) return;
  if (!window.termcanvas?.summary) return;
  if (inFlightRenderer.has(terminal.id)) return;

  inFlightRenderer.add(terminal.id);

  window.termcanvas.summary
    .generate({
      terminalId: terminal.id,
      sessionId: terminal.sessionId,
      sessionType: terminal.type as "claude" | "codex",
      cwd: worktreePath,
      summaryCli,
    })
    .then((result) => {
      if (result.ok && result.summary) {
        useProjectStore
          .getState()
          .updateTerminalCustomTitle(
            projectId,
            worktreeId,
            terminal.id,
            result.summary,
          );
        lastSummaryTimestamp.set(terminal.id, Date.now());
      }
    })
    .catch(() => {
      // silently ignore — not user-initiated in auto mode
    })
    .finally(() => {
      inFlightRenderer.delete(terminal.id);
    });
}

export function startAutoSummaryWatcher(): () => void {
  let disposed = false;

  const tick = () => {
    if (disposed) return;
    if (!window.termcanvas?.summary) return;

    const { projects } = useProjectStore.getState();
    const { summaryCli } = usePreferencesStore.getState();

    for (const project of projects) {
      for (const worktree of project.worktrees) {
        for (const terminal of worktree.terminals) {
          if (!SUMMARY_ELIGIBLE_TYPES.has(terminal.type)) continue;
          if (!terminal.sessionId) continue;
          if (terminal.focused) continue;
          if (terminal.status === "running" || terminal.status === "active") continue;

          const lastTs = lastSummaryTimestamp.get(terminal.id) ?? 0;
          if (Date.now() - lastTs < 60_000) continue;

          requestSummary(
            project.id,
            worktree.id,
            worktree.path,
            terminal,
            summaryCli,
          );
          return;
        }
      }
    }
  };

  const intervalId = setInterval(tick, AUTO_SUMMARY_INTERVAL_MS);

  return () => {
    disposed = true;
    clearInterval(intervalId);
  };
}
