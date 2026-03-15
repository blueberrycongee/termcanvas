import { useEffect } from "react";
import { useProjectStore, createTerminal } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useShortcutStore, matchesShortcut } from "../stores/shortcutStore";
import {
  packTerminals,
  WT_PAD,
  WT_TITLE_H,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";

function getAllTerminals() {
  const { projects } = useProjectStore.getState();
  const list: {
    projectId: string;
    worktreeId: string;
    terminalId: string;
    index: number;
  }[] = [];
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (let i = 0; i < w.terminals.length; i++) {
        list.push({
          projectId: p.id,
          worktreeId: w.id,
          terminalId: w.terminals[i].id,
          index: list.length,
        });
      }
    }
  }
  return list;
}

function getFocusedTerminalIndex(list: ReturnType<typeof getAllTerminals>) {
  const { projects } = useProjectStore.getState();
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        if (t.focused) {
          return list.findIndex((item) => item.terminalId === t.id);
        }
      }
    }
  }
  return -1;
}

function zoomToTerminal(
  projectId: string,
  worktreeId: string,
  terminalId: string,
) {
  const { projects } = useProjectStore.getState();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;
  const worktree = project.worktrees.find((w) => w.id === worktreeId);
  if (!worktree) return;
  const terminalIndex = worktree.terminals.findIndex(
    (t) => t.id === terminalId,
  );
  if (terminalIndex === -1) return;

  const packed = packTerminals(worktree.terminals.map((t) => t.span));
  const item = packed[terminalIndex];
  if (!item) return;

  const absX =
    project.position.x + PROJ_PAD + worktree.position.x + WT_PAD + item.x;
  const absY =
    project.position.y +
    PROJ_TITLE_H +
    PROJ_PAD +
    worktree.position.y +
    WT_TITLE_H +
    WT_PAD +
    item.y;

  const padding = 60;
  const viewW = window.innerWidth - padding * 2;
  const viewH = window.innerHeight - padding * 2;
  const scale = Math.min(viewW / item.w, viewH / item.h) * 0.85;

  const centerX = -(absX + item.w / 2) * scale + window.innerWidth / 2;
  const centerY = -(absY + item.h / 2) * scale + window.innerHeight / 2;

  useCanvasStore.getState().animateTo(centerX, centerY, scale);
}

export function useKeyboardShortcuts() {
  const shortcuts = useShortcutStore((s) => s.shortcuts);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (matchesShortcut(e, shortcuts.clearFocus)) {
        useProjectStore.getState().clearFocus();
        return;
      }

      if (matchesShortcut(e, shortcuts.toggleSidebar)) {
        e.preventDefault();
        const store = useCanvasStore.getState();
        store.setSidebarCollapsed(!store.sidebarCollapsed);
        return;
      }

      if (matchesShortcut(e, shortcuts.newTerminal)) {
        e.preventDefault();
        const { focusedProjectId, focusedWorktreeId, addTerminal } =
          useProjectStore.getState();
        if (focusedProjectId && focusedWorktreeId) {
          const terminal = createTerminal("shell");
          addTerminal(focusedProjectId, focusedWorktreeId, terminal);
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.nextTerminal)) {
        e.preventDefault();
        const list = getAllTerminals();
        if (list.length === 0) return;
        const currentIndex = getFocusedTerminalIndex(list);
        const nextIndex =
          currentIndex === -1 ? 0 : (currentIndex + 1) % list.length;
        const next = list[nextIndex];
        useProjectStore.getState().setFocusedTerminal(next.terminalId);
        zoomToTerminal(next.projectId, next.worktreeId, next.terminalId);
        return;
      }

      if (matchesShortcut(e, shortcuts.prevTerminal)) {
        e.preventDefault();
        const list = getAllTerminals();
        if (list.length === 0) return;
        const currentIndex = getFocusedTerminalIndex(list);
        const prevIndex =
          currentIndex <= 0 ? list.length - 1 : currentIndex - 1;
        const prev = list[prevIndex];
        useProjectStore.getState().setFocusedTerminal(prev.terminalId);
        zoomToTerminal(prev.projectId, prev.worktreeId, prev.terminalId);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts]);
}
