import { useEffect, useRef } from "react";
import {
  useProjectStore,
  createTerminal,
  generateId,
} from "../stores/projectStore";
import { useCanvasStore, RIGHT_PANEL_WIDTH, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useSelectionStore, type SelectedItem } from "../stores/selectionStore";
import {
  useShortcutStore,
  matchesShortcut,
  type ShortcutMap,
} from "../stores/shortcutStore";
import { useT } from "../i18n/useT";
import { useComposerStore } from "../stores/composerStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { getTerminalFocusOrder, getWorktreeFocusOrder } from "../stores/projectFocus";
import {
  packTerminals,
  computeWorktreeSize,
  WT_PAD,
  WT_TITLE_H,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";
import { shouldIgnoreShortcutTarget } from "./shortcutTarget";
import { snapshotState } from "../snapshotState";
import { updateWindowTitle } from "../titleHelper";
import { panToWorktree } from "../utils/panToWorktree";

function getAllTerminals() {
  const { projects } = useProjectStore.getState();
  return getTerminalFocusOrder(projects);
}

function getStarredTerminals() {
  const { projects } = useProjectStore.getState();
  const all = getTerminalFocusOrder(projects);
  return all.filter((item) => {
    const project = projects.find((p) => p.id === item.projectId);
    const worktree = project?.worktrees.find((w) => w.id === item.worktreeId);
    const terminal = worktree?.terminals.find((t) => t.id === item.terminalId);
    return terminal?.starred;
  });
}

function getAllWorktrees() {
  const { projects } = useProjectStore.getState();
  return getWorktreeFocusOrder(projects);
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

function getFocusedWorktreeIndex(
  list: { projectId: string; worktreeId: string }[],
) {
  const { focusedWorktreeId } = useProjectStore.getState();
  if (!focusedWorktreeId) return -1;
  return list.findIndex((item) => item.worktreeId === focusedWorktreeId);
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

  const { rightPanelCollapsed } = useCanvasStore.getState();
  const rightOffset = rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : RIGHT_PANEL_WIDTH;
  const padding = 60;
  const viewW = window.innerWidth - rightOffset - padding * 2;
  const viewH = window.innerHeight - padding * 2;
  const scale = Math.min(viewW / item.w, viewH / item.h) * 0.85;

  const centerX = -(absX + item.w / 2) * scale + (window.innerWidth - rightOffset) / 2;
  const centerY = -(absY + item.h / 2) * scale + window.innerHeight / 2;

  useCanvasStore.getState().animateTo(centerX, centerY, scale);
}

function zoomToFitAll() {
  const { projects } = useProjectStore.getState();
  if (projects.length === 0) return;
  const padding = 80;
  const toolbarH = 44;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of projects) {
    let maxW = 300;
    let totalH = 0;
    for (const wt of p.worktrees) {
      const wtSize = computeWorktreeSize(wt.terminals.map((t) => t.span));
      maxW = Math.max(maxW, wt.position.x + wtSize.w);
      totalH = Math.max(totalH, wt.position.y + wtSize.h);
    }
    const projW = Math.max(340, maxW + PROJ_PAD * 2);
    const projH = Math.max(
      PROJ_TITLE_H + PROJ_PAD + 60 + PROJ_PAD,
      PROJ_TITLE_H + PROJ_PAD + totalH + PROJ_PAD,
    );
    minX = Math.min(minX, p.position.x);
    minY = Math.min(minY, p.position.y);
    maxX = Math.max(maxX, p.position.x + projW);
    maxY = Math.max(maxY, p.position.y + projH);
  }
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const viewW = window.innerWidth - padding * 2;
  const viewH = window.innerHeight - toolbarH - padding * 2;
  const scale = Math.min(1, viewW / contentW, viewH / contentH);
  const x = -minX * scale + padding;
  const y = -minY * scale + padding + toolbarH;
  useCanvasStore.getState().animateTo(x, y, scale);
}

async function handleAddProject(t: ReturnType<typeof useT>) {
  if (!window.termcanvas) return;
  const { notify } = useNotificationStore.getState();

  let dirPath: string | null;
  try {
    dirPath = await window.termcanvas.project.selectDirectory();
  } catch (err) {
    notify("error", t.error_dir_picker(err));
    return;
  }
  if (!dirPath) return;

  let info: Awaited<ReturnType<typeof window.termcanvas.project.scan>>;
  try {
    info = await window.termcanvas.project.scan(dirPath);
  } catch (err) {
    notify("error", t.error_scan(err));
    return;
  }
  if (!info) {
    notify("warn", t.error_not_git(dirPath));
    return;
  }

  const { projects, addProject } = useProjectStore.getState();
  let placeX = 0;
  const gap = 80;
  for (const p of projects) {
    let maxW = 300;
    for (const wt of p.worktrees) {
      const wtSize = computeWorktreeSize(wt.terminals.map((tm) => tm.span));
      maxW = Math.max(maxW, wt.position.x + wtSize.w);
    }
    const projW = Math.max(340, maxW + PROJ_PAD * 2);
    placeX = Math.max(placeX, p.position.x + projW + gap);
  }

  addProject({
    id: generateId(),
    name: info.name,
    path: info.path,
    position: { x: placeX, y: 0 },
    collapsed: false,
    zIndex: 0,
    worktrees: info.worktrees.map((wt, i) => ({
      id: generateId(),
      name: wt.branch,
      path: wt.path,
      position: { x: 0, y: i * 360 },
      collapsed: false,
      terminals: [],
    })),
  });

  // Center viewport on the newly created project.
  // Compute actual project size (same logic as ProjectContainer).
  const newProject = useProjectStore.getState().projects.find(
    (p) => p.path === info.path,
  );

  // Auto-focus the first worktree so cmd+t works immediately
  if (newProject && newProject.worktrees.length > 0) {
    useProjectStore
      .getState()
      .setFocusedWorktree(newProject.id, newProject.worktrees[0].id);
  }

  let projH: number;
  if (!newProject || newProject.worktrees.length === 0) {
    projH = PROJ_TITLE_H + PROJ_PAD + 60 + PROJ_PAD;
  } else {
    let totalH = 0;
    for (const wt of newProject.worktrees) {
      const wtSize = computeWorktreeSize(wt.terminals.map((tm) => tm.span));
      totalH = Math.max(totalH, wt.position.y + wtSize.h);
    }
    projH = PROJ_TITLE_H + PROJ_PAD + totalH + PROJ_PAD;
  }
  // projW = 340: matches ProjectContainer's minWidth (new projects have
  // empty worktrees, so computed width never exceeds minWidth).
  const projW = 340;

  const { viewport: { scale }, rightPanelCollapsed } =
    useCanvasStore.getState();
  const rightOffset = rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : RIGHT_PANEL_WIDTH;
  const screenCenterX = (window.innerWidth - rightOffset) / 2;
  const screenCenterY = window.innerHeight / 2;
  const targetX = -(placeX + projW / 2) * scale + screenCenterX;
  const targetY = -(0 + projH / 2) * scale + screenCenterY;
  useCanvasStore.getState().animateTo(targetX, targetY, scale);

  notify("info", t.info_added_project(info.name, info.worktrees.length));
}

interface TerminalRef {
  projectId: string;
  worktreeId: string;
  terminalId: string;
}

export function useKeyboardShortcuts() {
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const t = useT();
  const lastFocusedRef = useRef<TerminalRef | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcutTarget(e)) {
        return;
      }

      if (matchesShortcut(e, shortcuts.addProject)) {
        e.preventDefault();
        handleAddProject(t);
        return;
      }

      if (matchesShortcut(e, shortcuts.clearFocus)) {
        e.preventDefault();
        const list = getAllTerminals();
        const focusedIdx = getFocusedTerminalIndex(list);

        if (focusedIdx !== -1) {
          // Currently focused → save it, clear focus, zoom out to fit all
          const focused = list[focusedIdx];
          lastFocusedRef.current = {
            projectId: focused.projectId,
            worktreeId: focused.worktreeId,
            terminalId: focused.terminalId,
          };
          useProjectStore.getState().clearFocus();
          zoomToFitAll();
        } else if (lastFocusedRef.current) {
          // Not focused, has history → restore last focused terminal
          const { projectId, worktreeId, terminalId } =
            lastFocusedRef.current;
          useProjectStore.getState().setFocusedTerminal(terminalId);
          zoomToTerminal(projectId, worktreeId, terminalId);
        } else if (list.length > 0) {
          // Never focused → focus the first terminal
          const first = list[0];
          lastFocusedRef.current = {
            projectId: first.projectId,
            worktreeId: first.worktreeId,
            terminalId: first.terminalId,
          };
          useProjectStore.getState().setFocusedTerminal(first.terminalId);
          zoomToTerminal(first.projectId, first.worktreeId, first.terminalId);
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.toggleRightPanel)) {
        e.preventDefault();
        const store = useCanvasStore.getState();
        store.setRightPanelCollapsed(!store.rightPanelCollapsed);
        return;
      }

      if (matchesShortcut(e, shortcuts.toggleStarFocused)) {
        e.preventDefault();
        const list = getAllTerminals();
        const focusedIdx = getFocusedTerminalIndex(list);
        if (focusedIdx !== -1) {
          const focused = list[focusedIdx];
          useProjectStore
            .getState()
            .toggleTerminalStarred(
              focused.projectId,
              focused.worktreeId,
              focused.terminalId,
            );
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.newTerminal)) {
        e.preventDefault();
        const { focusedProjectId, focusedWorktreeId, addTerminal, setFocusedTerminal } =
          useProjectStore.getState();
        if (focusedProjectId && focusedWorktreeId) {
          const terminal = createTerminal("shell");
          addTerminal(focusedProjectId, focusedWorktreeId, terminal);
          setFocusedTerminal(terminal.id);
          zoomToTerminal(focusedProjectId, focusedWorktreeId, terminal.id);
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.saveWorkspace)) {
        e.preventDefault();
        const snap = snapshotState();
        const { workspacePath } = useWorkspaceStore.getState();

        if (workspacePath) {
          window.termcanvas.workspace
            .saveToPath(workspacePath, snap)
            .then(async () => {
              await window.termcanvas.state.save(JSON.parse(snap));
              useWorkspaceStore.getState().markClean();
              updateWindowTitle();
            })
            .catch((err) => {
              useNotificationStore
                .getState()
                .notify("error", t.save_error(String(err)));
            });
        } else {
          window.termcanvas.workspace
            .save(snap)
            .then(async (savedPath) => {
              if (!savedPath) {
                return;
              }
              useWorkspaceStore.getState().setWorkspacePath(savedPath);
              await window.termcanvas.state.save(JSON.parse(snap));
              useWorkspaceStore.getState().markClean();
              updateWindowTitle();
            })
            .catch((err) => {
              useNotificationStore
                .getState()
                .notify("error", t.save_error(String(err)));
            });
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.saveWorkspaceAs)) {
        e.preventDefault();
        const snap = snapshotState();
        window.termcanvas.workspace
          .save(snap)
          .then(async (savedPath) => {
            if (!savedPath) {
              return;
            }
            useWorkspaceStore.getState().setWorkspacePath(savedPath);
            await window.termcanvas.state.save(JSON.parse(snap));
            useWorkspaceStore.getState().markClean();
            updateWindowTitle();
          })
          .catch((err) => {
            useNotificationStore
              .getState()
              .notify("error", t.save_error(String(err)));
          });
        return;
      }

      if (matchesShortcut(e, shortcuts.renameTerminalTitle)) {
        e.preventDefault();
        const list = getAllTerminals();
        const focusedIdx = getFocusedTerminalIndex(list);
        if (focusedIdx === -1) {
          useNotificationStore
            .getState()
            .notify("warn", t.composer_rename_title_missing_target);
          return;
        }

        const focused = list[focusedIdx];
        const project = useProjectStore
          .getState()
          .projects.find((p) => p.id === focused.projectId);
        const worktree = project?.worktrees.find((w) => w.id === focused.worktreeId);
        const terminal = worktree?.terminals.find((term) => term.id === focused.terminalId);
        if (!terminal) {
          useNotificationStore
            .getState()
            .notify("warn", t.composer_rename_title_missing_target);
          return;
        }

        const { composerEnabled } = usePreferencesStore.getState();
        if (composerEnabled) {
          useProjectStore.getState().setFocusedTerminal(terminal.id);
          useComposerStore
            .getState()
            .enterRenameTerminalTitleMode(terminal.id, terminal.customTitle ?? "");
        } else {
          useProjectStore
            .getState()
            .setFocusedTerminal(terminal.id, { focusComposer: false });
          window.dispatchEvent(
            new CustomEvent("termcanvas:focus-custom-title", {
              detail: terminal.id,
            }),
          );
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.closeFocused)) {
        e.preventDefault();
        const list = getAllTerminals();
        const focusedIdx = getFocusedTerminalIndex(list);
        if (focusedIdx !== -1) {
          const focused = list[focusedIdx];
          useProjectStore
            .getState()
            .removeTerminal(
              focused.projectId,
              focused.worktreeId,
              focused.terminalId,
            );
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.cycleFocusLevel)) {
        e.preventDefault();
        useCanvasStore.getState().cycleFocusLevel();
        return;
      }

      if (matchesShortcut(e, shortcuts.nextTerminal)) {
        e.preventDefault();
        const level = useCanvasStore.getState().focusLevel;

        if (level === "worktree") {
          const list = getAllWorktrees();
          if (list.length === 0) return;
          const currentIndex = getFocusedWorktreeIndex(list);
          const nextIndex =
            currentIndex === -1 ? 0 : (currentIndex + 1) % list.length;
          const next = list[nextIndex];
          useProjectStore.getState().setFocusedWorktree(next.projectId, next.worktreeId);
          panToWorktree(next.projectId, next.worktreeId);
          return;
        }

        const terminalList =
          level === "starred" ? getStarredTerminals() : getAllTerminals();

        if (terminalList.length === 0) return;
        const currentIndex = getFocusedTerminalIndex(terminalList);
        const nextIndex =
          currentIndex === -1 ? 0 : (currentIndex + 1) % terminalList.length;
        const next = terminalList[nextIndex];
        useProjectStore.getState().setFocusedTerminal(next.terminalId);
        zoomToTerminal(next.projectId, next.worktreeId, next.terminalId);
        return;
      }

      if (matchesShortcut(e, shortcuts.prevTerminal)) {
        e.preventDefault();
        const level = useCanvasStore.getState().focusLevel;

        if (level === "worktree") {
          const list = getAllWorktrees();
          if (list.length === 0) return;
          const currentIndex = getFocusedWorktreeIndex(list);
          const prevIndex =
            currentIndex <= 0 ? list.length - 1 : currentIndex - 1;
          const prev = list[prevIndex];
          useProjectStore.getState().setFocusedWorktree(prev.projectId, prev.worktreeId);
          panToWorktree(prev.projectId, prev.worktreeId);
          return;
        }

        const terminalList =
          level === "starred" ? getStarredTerminals() : getAllTerminals();

        if (terminalList.length === 0) return;
        const currentIndex = getFocusedTerminalIndex(terminalList);
        const prevIndex =
          currentIndex <= 0 ? terminalList.length - 1 : currentIndex - 1;
        const prev = terminalList[prevIndex];
        useProjectStore.getState().setFocusedTerminal(prev.terminalId);
        zoomToTerminal(prev.projectId, prev.worktreeId, prev.terminalId);
        return;
      }

      const SPAN_PRESETS: {
        key: keyof ShortcutMap;
        span: { cols: number; rows: number };
      }[] = [
        { key: "spanDefault", span: { cols: 1, rows: 1 } },
        { key: "spanWide", span: { cols: 2, rows: 1 } },
        { key: "spanTall", span: { cols: 1, rows: 2 } },
        { key: "spanLarge", span: { cols: 2, rows: 2 } },
      ];

      for (const preset of SPAN_PRESETS) {
        if (matchesShortcut(e, shortcuts[preset.key])) {
          e.preventDefault();
          const { projects, updateTerminalSpan } = useProjectStore.getState();
          for (const p of projects) {
            for (const w of p.worktrees) {
              const focused = w.terminals.find((t) => t.focused);
              if (focused) {
                updateTerminalSpan(p.id, w.id, focused.id, preset.span);
                return;
              }
            }
          }
          return;
        }
      }

      // Delete / Backspace — batch delete selected items
      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === "textarea" || tag === "canvas" || tag === "input") return;

        const { selectedItems, clearSelection } =
          useSelectionStore.getState();
        if (selectedItems.length === 0) return;

        e.preventDefault();

        const projectItems = selectedItems.filter(
          (i): i is Extract<SelectedItem, { type: "project" }> =>
            i.type === "project",
        );
        const worktreeItems = selectedItems.filter(
          (i): i is Extract<SelectedItem, { type: "worktree" }> =>
            i.type === "worktree",
        );
        const terminalItems = selectedItems.filter(
          (i): i is Extract<SelectedItem, { type: "terminal" }> =>
            i.type === "terminal",
        );
        const cardItems = selectedItems.filter(
          (i): i is Extract<SelectedItem, { type: "card" }> =>
            i.type === "card",
        );

        // Confirm if projects or worktrees are being deleted
        if (projectItems.length > 0 || worktreeItems.length > 0) {
          let message: string;
          if (projectItems.length > 0 && worktreeItems.length > 0) {
            message = t.confirm_delete_mixed(
              projectItems.length,
              worktreeItems.length,
            );
          } else if (projectItems.length > 0) {
            message = t.confirm_delete_projects(projectItems.length);
          } else {
            message = t.confirm_delete_worktrees(worktreeItems.length);
          }
          if (!window.confirm(message)) return;
        }

        const store = useProjectStore.getState();

        // Delete projects
        for (const item of projectItems) {
          store.removeProject(item.projectId);
        }

        // Delete worktrees
        for (const item of worktreeItems) {
          store.removeWorktree(item.projectId, item.worktreeId);
        }

        // Delete terminals
        for (const item of terminalItems) {
          store.removeTerminal(
            item.projectId,
            item.worktreeId,
            item.terminalId,
          );
        }

        // Close cards via CustomEvent
        for (const item of cardItems) {
          window.dispatchEvent(
            new CustomEvent("termcanvas:close-card", {
              detail: { cardId: item.cardId },
            }),
          );
        }

        clearSelection();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts, t]);
}
