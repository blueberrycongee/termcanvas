import { useEffect, useMemo } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useTerminalRuntimeStore } from "../terminal/terminalRuntimeStore";
import { useSessionStore } from "../stores/sessionStore";
import { resolveTerminalWithRuntimeState } from "../stores/terminalRuntimeStateStore";
import { useCompletionSeenStore } from "../stores/completionSeenStore";
import { deriveTerminalState, isCanvasTerminal } from "./sessionPanelModel";

export function CompletionGlow() {
  const projects = useProjectStore((s) => s.projects);
  const runtimeTerminals = useTerminalRuntimeStore((s) => s.terminals);
  const liveSessions = useSessionStore((s) => s.liveSessions);
  const historySessions = useSessionStore((s) => s.historySessions);
  const seenTerminalIds = useCompletionSeenStore((s) => s.seenTerminalIds);
  const markSeen = useCompletionSeenStore((s) => s.markSeen);
  const syncActiveDoneIds = useCompletionSeenStore((s) => s.syncActiveDoneIds);

  const sessionsById = useMemo(() => {
    const map = new Map<string, (typeof liveSessions)[number]>();
    for (const session of [...historySessions, ...liveSessions]) {
      map.set(session.sessionId, session);
    }
    return map;
  }, [historySessions, liveSessions]);

  const terminals: { id: string; state: string; focused: boolean }[] = [];
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        const resolved = resolveTerminalWithRuntimeState(t);
        if (!isCanvasTerminal(resolved)) continue;
        const telemetry = runtimeTerminals[resolved.id]?.telemetry ?? null;
        const session = resolved.sessionId
          ? sessionsById.get(resolved.sessionId)
          : undefined;
        const derived = deriveTerminalState(resolved, telemetry, session);
        terminals.push({
          id: resolved.id,
          state: derived.state,
          focused: resolved.focused,
        });
      }
    }
  }

  const focusedIdx = terminals.findIndex((t) => t.focused);

  useEffect(() => {
    if (focusedIdx === -1) return;
    const focused = terminals[focusedIdx];
    if (focused.state === "done" && !seenTerminalIds.has(focused.id)) {
      markSeen(focused.id);
    }
  });

  useEffect(() => {
    const activeDoneIds = terminals
      .filter((t) => t.state === "done")
      .map((t) => t.id);
    syncActiveDoneIds(activeDoneIds);
  });

  // Navigation is circular (nextTerminal wraps around), so the glow
  // direction must account for wrap-around.  "Left" means prevTerminal
  // would reach an unseen completed terminal; "right" means nextTerminal
  const unseen = (t: { id: string; state: string }) =>
    t.state === "done" && !seenTerminalIds.has(t.id);

  let showLeft = false;
  let showRight = false;

  if (focusedIdx === -1) {
    const hasUnseen = terminals.some(unseen);
    showLeft = hasUnseen;
    showRight = hasUnseen;
  } else {
    const n = terminals.length;
    for (let i = 0; i < n; i++) {
      if (i === focusedIdx || !unseen(terminals[i])) continue;
      const fwd = (i - focusedIdx + n) % n;
      const bwd = (focusedIdx - i + n) % n;
      if (fwd <= bwd) {
        showRight = true;
      } else {
        showLeft = true;
      }
      if (showLeft && showRight) break;
    }
  }

  return (
    <>
      <div
        className="fixed left-0 pointer-events-none z-40 transition-opacity duration-500 ease-out"
        style={{
          top: 44,
          width: 90,
          height: "calc(100vh - 44px)",
          background:
            "linear-gradient(to right, color-mix(in srgb, var(--accent) 28%, transparent), transparent)",
          opacity: showLeft ? 1 : 0,
        }}
      />
      <div
        className="fixed right-0 pointer-events-none z-40 transition-opacity duration-500 ease-out"
        style={{
          top: 44,
          width: 90,
          height: "calc(100vh - 44px)",
          background:
            "linear-gradient(to left, color-mix(in srgb, var(--accent) 28%, transparent), transparent)",
          opacity: showRight ? 1 : 0,
        }}
      />
    </>
  );
}
