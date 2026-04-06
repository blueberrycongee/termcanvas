import { useEffect, useMemo } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useCompletionSeenStore } from "../stores/completionSeenStore";

export function CompletionGlow() {
  const projects = useProjectStore((s) => s.projects);
  const seenTerminalIds = useCompletionSeenStore((s) => s.seenTerminalIds);
  const markSeen = useCompletionSeenStore((s) => s.markSeen);
  const syncActiveDoneIds = useCompletionSeenStore((s) => s.syncActiveDoneIds);

  const terminals: { id: string; status: string; focused: boolean }[] = [];
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        terminals.push({ id: t.id, status: t.status, focused: t.focused });
      }
    }
  }

  const focusedIdx = terminals.findIndex((t) => t.focused);
  const activeDoneIds = useMemo(
    () => terminals.filter((terminal) => terminal.status === "completed").map((terminal) => terminal.id),
    [terminals],
  );

  useEffect(() => {
    syncActiveDoneIds(activeDoneIds);
  }, [activeDoneIds, syncActiveDoneIds]);

  useEffect(() => {
    if (focusedIdx === -1) return;
    const focused = terminals[focusedIdx];
    if (focused.status === "completed") {
      markSeen(focused.id);
    }
  }, [focusedIdx, markSeen, terminals]);

  // Navigation is circular (nextTerminal wraps around), so the glow
  // direction must account for wrap-around.  "Left" means prevTerminal
  // would reach an unseen completed terminal; "right" means nextTerminal
  const unseen = (t: { id: string; status: string }) =>
    t.status === "completed" && !seenTerminalIds.has(t.id);

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
