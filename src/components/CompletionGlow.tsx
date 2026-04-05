import { useRef, useState, useEffect } from "react";
import { useProjectStore } from "../stores/projectStore";
import {
  resolveTerminalWithRuntimeState,
  useTerminalRuntimeStateStore,
} from "../stores/terminalRuntimeStateStore";

export function CompletionGlow() {
  const projects = useProjectStore((s) => s.projects);
  const terminalRuntimeStates = useTerminalRuntimeStateStore((s) => s.terminals);
  const seenRef = useRef(new Set<string>());
  const [, forceUpdate] = useState(0);

  const terminals: { id: string; status: string; focused: boolean }[] = [];
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        const liveTerminal = resolveTerminalWithRuntimeState(
          t,
          terminalRuntimeStates[t.id],
        );
        terminals.push({
          id: liveTerminal.id,
          status: liveTerminal.status,
          focused: liveTerminal.focused,
        });
      }
    }
  }

  const focusedIdx = terminals.findIndex((t) => t.focused);

  useEffect(() => {
    if (focusedIdx === -1) return;
    const focused = terminals[focusedIdx];
    if (focused.status === "completed" && !seenRef.current.has(focused.id)) {
      seenRef.current.add(focused.id);
      forceUpdate((n) => n + 1);
    }
  });

  useEffect(() => {
    const seen = seenRef.current;
    let changed = false;
    for (const id of seen) {
      const t = terminals.find((t) => t.id === id);
      if (!t || t.status !== "completed") {
        seen.delete(id);
        changed = true;
      }
    }
    if (changed) forceUpdate((n) => n + 1);
  });

  // Navigation is circular (nextTerminal wraps around), so the glow
  // direction must account for wrap-around.  "Left" means prevTerminal
  // would reach an unseen completed terminal; "right" means nextTerminal
  const unseen = (t: { id: string; status: string }) =>
    t.status === "completed" && !seenRef.current.has(t.id);

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
