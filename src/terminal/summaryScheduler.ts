import type { TerminalData } from "../types/index.ts";
import { useProjectStore } from "../stores/projectStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useLocaleStore } from "../stores/localeStore";

type SummaryCli = "claude" | "codex";

const SUMMARY_ELIGIBLE_TYPES = new Set(["claude", "codex"]);
const AUTO_SUMMARY_INTERVAL_MS = 10 * 60_000; // 10 minutes

const inFlightRenderer = new Set<string>();
const lastSummarySessionSize = new Map<string, number>();

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
  console.log(`[SummaryScheduler] requesting summary for ${terminal.id.slice(0, 8)} (${terminal.type})`);

  const locale = useLocaleStore.getState().locale;

  window.termcanvas.summary
    .generate({
      terminalId: terminal.id,
      sessionId: terminal.sessionId,
      sessionType: terminal.type as "claude" | "codex",
      cwd: worktreePath,
      summaryCli,
      locale,
    })
    .then((result) => {
      if (result.ok && result.summary) {
        console.log(`[SummaryScheduler] success for ${terminal.id.slice(0, 8)}: "${result.summary}"`);
        useProjectStore
          .getState()
          .updateTerminalCustomTitle(
            projectId,
            worktreeId,
            terminal.id,
            result.summary,
          );
        if (result.sessionFileSize != null) {
          lastSummarySessionSize.set(terminal.id, result.sessionFileSize);
        }
      } else {
        console.warn(`[SummaryScheduler] failed for ${terminal.id.slice(0, 8)}: ${result.error}`);
        useNotificationStore.getState().notify("warn", `Summary failed: ${result.error}`);
      }
    })
    .catch((err) => {
      console.error(`[SummaryScheduler] IPC error for ${terminal.id.slice(0, 8)}:`, err);
      useNotificationStore.getState().notify("error", `Summary error: ${String(err)}`);
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

          // Skip if already summarized and no known new content
          if (terminal.customTitle && lastSummarySessionSize.has(terminal.id)) continue;

          requestSummary(
            project.id,
            worktree.id,
            worktree.path,
            terminal,
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
