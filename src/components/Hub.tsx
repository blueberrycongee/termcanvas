import { useCanvasStore, type FocusLevel } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useShortcutStore, formatShortcut } from "../stores/shortcutStore";
import { getWorktreeFocusOrder } from "../stores/projectFocus";
import { getTerminalFocusOrder } from "../stores/projectFocus";
import { panToWorktree } from "../utils/panToWorktree";
import { useT } from "../i18n/useT";
import { useState, useCallback, useEffect, useRef } from "react";

const LEVEL_ICONS: Record<FocusLevel, string> = {
  terminal: "▣",
  starred: "★",
  worktree: "⌥",
};

interface FocusTarget {
  id: string;
  label: string;
  projectId: string;
  worktreeId: string;
  terminalId?: string;
}

export function Hub() {
  const { focusLevel } = useCanvasStore();
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

  useEffect(() => {
    setSelectedIndex(0);
  }, [expanded, focusLevel]);

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

  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [selectedIndex]);

  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform?.startsWith("Mac");
  const levelShortcut = formatShortcut(shortcuts.cycleFocusLevel, !!isMac);
  const levelLabel = t[`hub.level.${focusLevel}`];

  return (
    <div
      ref={containerRef}
      className="fixed top-2 left-2 z-50 select-none"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
          bg-bg-secondary/90 backdrop-blur border border-border-primary
          text-text-primary text-xs font-medium
          hover:bg-bg-tertiary transition-colors cursor-pointer"
        title={`${levelLabel} (${levelShortcut})`}
      >
        <span className="text-text-muted">{LEVEL_ICONS[focusLevel]}</span>
        <span className="max-w-[200px] truncate">{currentTarget}</span>
      </button>

      {expanded && (
        <div
          className="mt-1 rounded-lg bg-bg-secondary/95 backdrop-blur
            border border-border-primary shadow-lg
            max-h-[300px] overflow-y-auto min-w-[200px]"
        >
          <div className="px-3 py-1.5 text-[10px] text-text-muted uppercase tracking-wider border-b border-border-primary flex items-center justify-between">
            <span>{levelLabel}</span>
            <span className="text-text-muted/50">{levelShortcut}</span>
          </div>

          {targets.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted">
              {t["hub.empty"]}
            </div>
          ) : (
            targets.map((target, i) => (
              <button
                key={target.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onClick={() => selectTarget(target)}
                className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer
                  hover:bg-bg-tertiary transition-colors truncate
                  ${i === selectedIndex ? "bg-bg-tertiary text-text-primary" : "text-text-secondary"}`}
              >
                {target.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
