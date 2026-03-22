import { useRef, useState, useEffect } from "react";
import { useProjectStore } from "../stores/projectStore";

export function CompletionGlow() {
  const projects = useProjectStore((s) => s.projects);
  const seenRef = useRef(new Set<string>());
  const [, forceUpdate] = useState(0);

  // Build flat navigation list (same order as useKeyboardShortcuts)
  const terminals: { id: string; status: string; focused: boolean }[] = [];
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        terminals.push({ id: t.id, status: t.status, focused: t.focused });
      }
    }
  }

  // Find focused index
  const focusedIdx = terminals.findIndex((t) => t.focused);

  // When focused terminal is completed, mark it seen
  useEffect(() => {
    if (focusedIdx === -1) return;
    const focused = terminals[focusedIdx];
    if (focused.status === "completed" && !seenRef.current.has(focused.id)) {
      seenRef.current.add(focused.id);
      forceUpdate((n) => n + 1);
    }
  });

  // Clean seen set: remove terminals that are no longer completed
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

  // Compute which sides to show.
  // Navigation is circular (nextTerminal wraps around), so the glow
  // direction must account for wrap-around.  "Left" means prevTerminal
  // would reach an unseen completed terminal; "right" means nextTerminal
  // would.  We pick the shorter circular direction for each unseen
  // terminal to decide which side to illuminate.
  const unseen = (t: { id: string; status: string }) =>
    t.status === "completed" && !seenRef.current.has(t.id);

  let showLeft = false;
  let showRight = false;

  if (focusedIdx === -1) {
    // No focus: any unseen completed → show both sides
    const hasUnseen = terminals.some(unseen);
    showLeft = hasUnseen;
    showRight = hasUnseen;
  } else {
    const n = terminals.length;
    for (let i = 0; i < n; i++) {
      if (i === focusedIdx || !unseen(terminals[i])) continue;
      // Distance going forward (nextTerminal direction → right glow)
      const fwd = (i - focusedIdx + n) % n;
      // Distance going backward (prevTerminal direction → left glow)
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
            "linear-gradient(to right, rgba(59,130,246,0.28), transparent)",
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
            "linear-gradient(to left, rgba(59,130,246,0.28), transparent)",
          opacity: showRight ? 1 : 0,
        }}
      />
    </>
  );
}
