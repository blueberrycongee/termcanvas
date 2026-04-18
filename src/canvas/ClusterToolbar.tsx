import { useCallback, useEffect, useRef, useState } from "react";
import { useClusterStore } from "../stores/clusterStore";
import { useCanvasStore } from "../stores/canvasStore";
import { TOOLBAR_HEIGHT } from "../toolbar/Toolbar";
import { getCanvasRightInset } from "./viewportBounds";
import type { ClusterRule } from "../clustering";

interface RuleOption {
  rule: ClusterRule;
  label: string;
}

const RULE_OPTIONS: RuleOption[] = [
  { rule: "by-project", label: "By Project" },
  { rule: "by-worktree", label: "By Worktree" },
  { rule: "by-type", label: "By Type" },
  { rule: "by-status", label: "By Status" },
  { rule: "by-custom", label: "By Custom Tag" },
];

const TOP_OFFSET = TOOLBAR_HEIGHT + 8;

export function ClusterToolbar() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const applyCluster = useClusterStore((state) => state.applyCluster);
  const undoCluster = useClusterStore((state) => state.undoCluster);
  const canUndo = useClusterStore((state) => state.positionSnapshot !== null);
  const lastRule = useClusterStore((state) => state.lastRule);
  const rightPanelCollapsed = useCanvasStore(
    (state) => state.rightPanelCollapsed,
  );
  const rightPanelWidth = useCanvasStore((state) => state.rightPanelWidth);

  const handlePick = useCallback(
    (rule: ClusterRule) => {
      applyCluster(rule);
      setOpen(false);
    },
    [applyCluster],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Use capture so the listener fires before React Flow's pane handlers
    // call stopPropagation on the canvas, which would otherwise swallow the
    // event and leave the dropdown stuck open.
    window.addEventListener("mousedown", handler, true);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("mousedown", handler, true);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  const rightInset = getCanvasRightInset(rightPanelCollapsed, rightPanelWidth) + 16;

  return (
    <div
      className="fixed z-40 flex items-center gap-2 nowheel"
      style={{ top: TOP_OFFSET, right: rightInset }}
    >
      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          className="px-3 py-1 rounded-md border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-[11px] text-[var(--text-primary)] shadow-sm transition-colors"
          style={{ fontFamily: '"Geist Mono", monospace' }}
          onClick={() => setOpen((value) => !value)}
        >
          Cluster{lastRule ? ` · ${formatRule(lastRule)}` : ""}
        </button>
        {open && (
          <div
            className="absolute right-0 mt-1 min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden py-1"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {RULE_OPTIONS.map((option) => (
              <button
                key={option.rule}
                type="button"
                className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] transition-colors"
                onClick={() => handlePick(option.rule)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {canUndo && (
        <button
          type="button"
          onClick={() => undoCluster()}
          title="Undo last cluster"
          className="px-3 py-1 rounded-md border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-[11px] text-[var(--text-primary)] shadow-sm transition-colors"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          Undo
        </button>
      )}
    </div>
  );
}

function formatRule(rule: ClusterRule): string {
  switch (rule) {
    case "by-project":
      return "Project";
    case "by-worktree":
      return "Worktree";
    case "by-type":
      return "Type";
    case "by-status":
      return "Status";
    case "by-custom":
      return "Custom";
  }
}
