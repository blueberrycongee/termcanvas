import { useCanvasStore, type FocusLevel, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useShortcutStore, formatShortcut } from "../stores/shortcutStore";
import { getWorktreeFocusOrder, getTerminalFocusOrder } from "../stores/projectFocus";
import { panToWorktree } from "../utils/panToWorktree";
import { useT } from "../i18n/useT";
import { useState, useCallback, useEffect, useRef } from "react";

const LEVEL_ICONS: Record<FocusLevel, string> = {
  terminal: "▣",
  starred: "★",
  worktree: "⌥",
};

// Spring-approximating cubic-beziers derived from Spotlight's CASpringAnimation params
// Invocation: perceptualDuration=0.28, bounce=0.41 → overshoot ~2-3%
const SPRING_IN = "cubic-bezier(0.34, 1.56, 0.64, 1)";
// Dismissal: perceptualDuration=0.28, bounce=0.32 → tighter, snappier
const SPRING_OUT = "cubic-bezier(0.32, 1.25, 0.64, 1)";

interface FocusTarget {
  id: string;
  label: string;
  projectId: string;
  worktreeId: string;
  terminalId?: string;
}

export function Hub() {
  const { focusLevel, leftPanelCollapsed, leftPanelWidth } = useCanvasStore();
  const { projects, focusedWorktreeId, setFocusedTerminal, setFocusedWorktree } =
    useProjectStore();
  const { shortcuts } = useShortcutStore();
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const targets: FocusTarget[] = (() => {
    if (focusLevel === "worktree") {
      return getWorktreeFocusOrder(projects).map((item) => {
        const project = projects.find((p) => p.id === item.projectId);
        const worktree = project?.worktrees.find(
          (w) => w.id === item.worktreeId,
        );
        return {
          id: item.worktreeId,
          label: `${project?.name ?? "?"} / ${worktree?.name ?? "?"}`,
          projectId: item.projectId,
          worktreeId: item.worktreeId,
        };
      });
    }

    const terminalItems =
      focusLevel === "starred"
        ? getTerminalFocusOrder(projects).filter((item) => {
            const project = projects.find((p) => p.id === item.projectId);
            const worktree = project?.worktrees.find(
              (w) => w.id === item.worktreeId,
            );
            return worktree?.terminals.find(
              (t) => t.id === item.terminalId,
            )?.starred;
          })
        : getTerminalFocusOrder(projects);

    return terminalItems.map((item) => {
      const project = projects.find((p) => p.id === item.projectId);
      const worktree = project?.worktrees.find(
        (w) => w.id === item.worktreeId,
      );
      const terminal = worktree?.terminals.find(
        (t) => t.id === item.terminalId,
      );
      return {
        id: item.terminalId,
        label: terminal?.customTitle || terminal?.title || "?",
        projectId: item.projectId,
        worktreeId: item.worktreeId,
        terminalId: item.terminalId,
      };
    });
  })();

  const currentTarget = (() => {
    if (focusLevel === "worktree") {
      const wt = targets.find((target) => target.worktreeId === focusedWorktreeId);
      return wt?.label ?? t["hub.none"];
    }
    const focused = projects
      .flatMap((p) => p.worktrees.flatMap((w) => w.terminals))
      .find((terminal) => terminal.focused);
    if (!focused) return t["hub.none"];
    return focused.customTitle || focused.title;
  })();

  const selectTarget = useCallback(
    (target: FocusTarget) => {
      setExpanded(false);
      if (target.terminalId) {
        setFocusedTerminal(target.terminalId);
      } else {
        setFocusedWorktree(target.projectId, target.worktreeId);
        panToWorktree(target.projectId, target.worktreeId);
      }
    },
    [setFocusedTerminal, setFocusedWorktree],
  );

  // Keyboard nav when expanded
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, targets.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (targets[selectedIndex]) selectTarget(targets[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [expanded, selectedIndex, targets, selectTarget]);

  // Reset selection on open / level change
  useEffect(() => {
    setSelectedIndex(0);
  }, [expanded, focusLevel]);

  // Click outside to close
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [expanded]);

  // Scroll selected into view
  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform?.startsWith("Mac");
  const levelShortcut = formatShortcut(shortcuts.cycleFocusLevel, !!isMac);
  const levelLabel = t[`hub.level.${focusLevel}`];

  const leftOffset = leftPanelCollapsed ? COLLAPSED_TAB_WIDTH + 12 : leftPanelWidth + 12;

  return (
    <div
      ref={containerRef}
      className="fixed z-50 select-none"
      style={{ top: 52, left: leftOffset, transition: "left 0.2s ease" }}
    >
      {/* Capsule trigger */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md
          border border-[var(--border)] bg-[var(--surface)]
          text-[var(--text-secondary)] text-[12px]
          hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]
          transition-colors duration-150 cursor-pointer"
        style={{ transition: `colors 150ms, transform 280ms ${expanded ? SPRING_IN : SPRING_OUT}` }}
        title={`${levelLabel} (${levelShortcut})`}
      >
        <span className="text-[var(--text-muted)] text-[11px]">{LEVEL_ICONS[focusLevel]}</span>
        <span className="max-w-[180px] truncate">{currentTarget}</span>
        <svg
          width="8" height="8" viewBox="0 0 8 8"
          className="text-[var(--text-muted)] ml-0.5"
          style={{
            transition: `transform 280ms ${expanded ? SPRING_IN : SPRING_OUT}`,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>

      {/* Dropdown panel */}
      <div
        className="mt-1 rounded-lg border border-[var(--border)]
          overflow-hidden origin-top"
        style={{
          // Asymmetric spring transitions: bouncy enter, snappy exit
          transition: expanded
            ? `transform 280ms ${SPRING_IN}, opacity 100ms ease-out, backdrop-filter 280ms ${SPRING_IN}`
            : `transform 200ms ${SPRING_OUT}, opacity 120ms ease-in, backdrop-filter 200ms ease-out`,
          transform: expanded ? "scale(1)" : "scale(0.95)",
          opacity: expanded ? 1 : 0,
          pointerEvents: expanded ? "auto" : "none",
          // Glass material — translucent surface + blur
          backgroundColor: "color-mix(in srgb, var(--surface) 85%, transparent)",
          backdropFilter: expanded ? "blur(20px) saturate(1.4)" : "blur(0px) saturate(1)",
          WebkitBackdropFilter: expanded ? "blur(20px) saturate(1.4)" : "blur(0px) saturate(1)",
          boxShadow: expanded
            ? "0 8px 32px rgba(0,0,0,0.28), 0 0 0 0.5px rgba(255,255,255,0.06) inset"
            : "none",
        }}
      >
        {/* Level header */}
        <div className="px-3 py-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border)] flex items-center justify-between">
          <span>{levelLabel}</span>
          <span className="text-[var(--text-faint)]">{levelShortcut}</span>
        </div>

        {/* Target list */}
        <div className="overflow-y-auto py-0.5" style={{ maxHeight: 260 }}>
          {targets.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">
              {t["hub.empty"]}
            </div>
          ) : (
            targets.map((target, i) => (
              <button
                key={target.id}
                ref={(el) => { itemRefs.current[i] = el; }}
                onClick={() => selectTarget(target)}
                className={`w-full text-left px-3 py-1.5 text-[12px] cursor-pointer
                  transition-colors duration-75 truncate
                  ${i === selectedIndex
                    ? "bg-[var(--accent)]/15 text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--border)]/50 hover:text-[var(--text-primary)]"
                  }`}
              >
                {target.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
