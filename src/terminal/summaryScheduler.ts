import { create } from "zustand";
import type { TerminalData } from "../types/index.ts";
import { updateTerminalCustomTitleInScene } from "../actions/terminalSceneActions";
import { useProjectStore } from "../stores/projectStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useLocaleStore } from "../stores/localeStore";
import { resolveTerminalWithRuntimeState } from "../stores/terminalRuntimeStateStore";

type SummaryCli = "claude" | "codex";

const SUMMARY_ELIGIBLE_TYPES = new Set(["claude", "codex"]);
const AUTO_SUMMARY_INTERVAL_MS = 10 * 60_000; // 10 minutes

const useSummaryFlightStore = create<{ ids: Set<string> }>(() => ({
  ids: new Set(),
}));

function addInFlight(id: string) {
  useSummaryFlightStore.setState((s) => {
    const next = new Set(s.ids);
    next.add(id);
    return { ids: next };
  });
}

function removeInFlight(id: string) {
  useSummaryFlightStore.setState((s) => {
    const next = new Set(s.ids);
    next.delete(id);
    return { ids: next };
  });
}

export function useIsSummarizing(terminalId: string): boolean {
  return useSummaryFlightStore((s) => s.ids.has(terminalId));
}

const lastSummarySessionSize = new Map<string, number>();

export function requestSummary(
  projectId: string,
  worktreeId: string,
  worktreePath: string,
  terminal: TerminalData,
  summaryCli: SummaryCli,
): void {
  const liveTerminal = resolveTerminalWithRuntimeState(terminal);

  if (!SUMMARY_ELIGIBLE_TYPES.has(liveTerminal.type)) return;
  if (!liveTerminal.sessionId) return;
  if (!window.termcanvas?.summary) return;
  if (useSummaryFlightStore.getState().ids.has(liveTerminal.id)) return;

  addInFlight(liveTerminal.id);
  console.log(`[SummaryScheduler] requesting summary for ${liveTerminal.id.slice(0, 8)} (${liveTerminal.type})`);

  const locale = useLocaleStore.getState().locale;

  window.termcanvas.summary
    .generate({
      terminalId: liveTerminal.id,
      sessionId: liveTerminal.sessionId,
      sessionType: liveTerminal.type as "claude" | "codex",
      cwd: worktreePath,
      summaryCli,
      locale,
    })
    .then((result) => {
      if (result.ok && result.summary) {
        console.log(`[SummaryScheduler] success for ${liveTerminal.id.slice(0, 8)}: "${result.summary}"`);
        updateTerminalCustomTitleInScene(
          projectId,
          worktreeId,
          liveTerminal.id,
          result.summary,
        );
        if (result.sessionFileSize != null) {
          lastSummarySessionSize.set(liveTerminal.id, result.sessionFileSize);
        }
      } else {
        console.warn(`[SummaryScheduler] failed for ${liveTerminal.id.slice(0, 8)}: ${result.error}`);
        useNotificationStore.getState().notify("warn", `Summary failed: ${result.error}`);
      }
    })
    .catch((err) => {
      console.error(`[SummaryScheduler] IPC error for ${liveTerminal.id.slice(0, 8)}:`, err);
      useNotificationStore.getState().notify("error", `Summary error: ${String(err)}`);
    })
    .finally(() => {
      removeInFlight(liveTerminal.id);
    });
}

const turnCompletedTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function onTerminalTurnCompleted(terminalId: string): void {
  // Debounce: wait 5s in case of rapid turn completions
  if (turnCompletedTimers.has(terminalId)) return;

  const timer = setTimeout(() => {
    turnCompletedTimers.delete(terminalId);
    if (!window.termcanvas?.summary) return;

    const { projects } = useProjectStore.getState();
    const { summaryCli } = usePreferencesStore.getState();

    for (const project of projects) {
      for (const worktree of project.worktrees) {
        const terminal = worktree.terminals.find((t) => t.id === terminalId);
        if (!terminal) continue;
        const liveTerminal = resolveTerminalWithRuntimeState(terminal);
        if (!SUMMARY_ELIGIBLE_TYPES.has(liveTerminal.type)) return;
        if (!liveTerminal.sessionId) return;
        if (liveTerminal.origin === "agent") return;
        if (liveTerminal.focused) return;
        if (
          liveTerminal.customTitle &&
          lastSummarySessionSize.has(liveTerminal.id)
        ) {
          return;
        }

        requestSummary(
          project.id,
          worktree.id,
          worktree.path,
          liveTerminal,
          summaryCli,
        );
        return;
      }
    }
  }, 5_000);
  turnCompletedTimers.set(terminalId, timer);
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
          const liveTerminal = resolveTerminalWithRuntimeState(terminal);
          if (!SUMMARY_ELIGIBLE_TYPES.has(liveTerminal.type)) continue;
          if (!liveTerminal.sessionId) continue;
          if (liveTerminal.origin === "agent") continue;
          if (liveTerminal.focused) continue;
          if (
            liveTerminal.status === "running" ||
            liveTerminal.status === "active"
          ) {
            continue;
          }

          // Skip if already summarized and no known new content
          if (
            liveTerminal.customTitle &&
            lastSummarySessionSize.has(liveTerminal.id)
          ) {
            continue;
          }

          requestSummary(
            project.id,
            worktree.id,
            worktree.path,
            liveTerminal,
            summaryCli,
          );
          return; // one at a time
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
