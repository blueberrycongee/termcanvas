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

  // Compute which sides to show
  const unseen = (t: { id: string; status: string }) =>
    t.status === "completed" && !seenRef.current.has(t.id);

  let showLeft = false;
  let showRight = false;

  if (focusedIdx === -1) {
    // No focus: any unseen completed → right glow
    showRight = terminals.some(unseen);
  } else {
    showLeft = terminals.slice(0, focusedIdx).some(unseen);
    showRight = terminals.slice(focusedIdx + 1).some(unseen);
  }

  return (
    <>
      <div
        className="fixed left-0 pointer-events-none z-40 transition-opacity duration-300 ease-out"
        style={{
          top: 44,
          width: 60,
          height: "calc(100vh - 44px)",
          background:
            "linear-gradient(to right, rgba(59,130,246,0.12), transparent)",
          opacity: showLeft ? 1 : 0,
        }}
      />
      <div
        className="fixed right-0 pointer-events-none z-40 transition-opacity duration-300 ease-out"
        style={{
          top: 44,
          width: 60,
          height: "calc(100vh - 44px)",
          background:
            "linear-gradient(to left, rgba(59,130,246,0.12), transparent)",
          opacity: showRight ? 1 : 0,
        }}
      />
    </>
  );
}
