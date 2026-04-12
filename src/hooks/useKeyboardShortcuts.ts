import { useEffect, useRef } from "react";
import { useViewportFocusStore } from "../stores/viewportFocusStore";
import { deleteSelectedSceneItems } from "../actions/sceneDeleteActions";
import {
  activateTerminalInScene,
  activateWorktreeInScene,
  focusWorktreeInScene,
} from "../actions/sceneSelectionActions";
import {
  closeTerminalInScene,
  createTerminalInScene,
  focusTerminalInScene,
  toggleTerminalStarredInScene,
} from "../actions/terminalSceneActions";
import { useProjectStore } from "../stores/projectStore";
import {
  addScannedProjectAndFocus,
  ensureTerminalCreationTarget,
} from "../projects/projectCreation";
import { useCanvasStore } from "../stores/canvasStore";
import { useNotificationStore } from "../stores/notificationStore";
import { promptAndAddProjectToScene } from "../canvas/sceneCommands";
import { useShortcutStore, matchesShortcut } from "../stores/shortcutStore";
import { useT } from "../i18n/useT";
import { useComposerStore } from "../stores/composerStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsModalStore } from "../stores/settingsModalStore";
import {
  getSpatialTerminalOrder,
  getTerminalFocusOrder,
  getWorktreeFocusOrder,
} from "../stores/projectFocus";
import { pickCloseFocusTarget } from "../canvas/closeFocusTarget";
import { shouldIgnoreShortcutTarget } from "./shortcutTarget";
import { snapshotStateWithRefresh } from "../snapshotState";
import { updateWindowTitle } from "../titleHelper";
import { panToTerminal } from "../utils/panToTerminal";
import { panToWorktree } from "../utils/panToWorktree";
import {
  getCanvasRightInset,
  getCanvasLeftInset,
} from "../canvas/viewportBounds";

function getAllTerminals() {
  const { projects } = useProjectStore.getState();
  return getTerminalFocusOrder(projects);
}

// Visual reading order used by cmd+] / cmd+[ so prev/next follows perceived
// rows on the canvas rather than raw array order or strict top-left scanlines.
function getAllTerminalsSpatial() {
  const { projects } = useProjectStore.getState();
  return getSpatialTerminalOrder(projects);
}

function getStarredTerminalsSpatial() {
  const { projects } = useProjectStore.getState();
  const ordered = getSpatialTerminalOrder(projects);
  return ordered.filter((item) => {
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

function findFocusedTerminalLocation(
  projects: ReturnType<typeof useProjectStore.getState>["projects"],
): { projectId: string; worktreeId: string; terminalId: string } | null {
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        if (t.focused) {
          return { projectId: p.id, worktreeId: w.id, terminalId: t.id };
        }
      }
    }
  }
  return null;
}

function getFocusedWorktreeIndex(
  list: { projectId: string; worktreeId: string }[],
) {
  const { focusedWorktreeId } = useProjectStore.getState();
  if (!focusedWorktreeId) return -1;
  return list.findIndex((item) => item.worktreeId === focusedWorktreeId);
}

function zoomToTerminal(terminalId: string) {
  panToTerminal(terminalId);
}

function getZoomedOutTerminalId(): string | null {
  return useViewportFocusStore.getState().zoomedOutTerminalId;
}

function setZoomedOutTerminalId(terminalId: string | null): void {
  useViewportFocusStore.getState().setZoomedOutTerminalId(terminalId);
}

export function navigateToTerminalWithViewport(
  terminalId: string,
  options: {
    zoomedOutTerminalId: string | null;
    pan?: typeof panToTerminal;
    zoom?: typeof zoomToTerminal;
  },
): string | null {
  const pan = options.pan ?? panToTerminal;
  const zoom = options.zoom ?? zoomToTerminal;

  if (options.zoomedOutTerminalId !== null) {
    pan(terminalId, { preserveScale: true });
    return terminalId;
  }

  zoom(terminalId);
  return null;
}

function zoomToFitAll() {
  const { projects } = useProjectStore.getState();
  const { rightPanelCollapsed, leftPanelCollapsed, leftPanelWidth } =
    useCanvasStore.getState();
  if (projects.length === 0) return;
  const padding = 80;
  const toolbarH = 44;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        if (t.stashed) continue;
        minX = Math.min(minX, t.x);
        minY = Math.min(minY, t.y);
        maxX = Math.max(maxX, t.x + t.width);
        maxY = Math.max(maxY, t.y + t.height);
      }
    }
  }
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const rightOffset = getCanvasRightInset(rightPanelCollapsed);
  const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const viewW = window.innerWidth - leftOffset - rightOffset - padding * 2;
  const viewH = window.innerHeight - toolbarH - padding * 2;
  const scale = Math.min(1, viewW / contentW, viewH / contentH);
  const x = -minX * scale + padding;
  const y = -minY * scale + padding + toolbarH;
  useCanvasStore.getState().animateTo(x, y, scale);
}

async function handleAddProject(t: ReturnType<typeof useT>) {
  const createdProject = await promptAndAddProjectToScene(t, {
    notifyAdded: true,
  });
  if (!createdProject) return;

  // Compute actual project size (same logic as ProjectContainer).
  const newProject = useProjectStore
    .getState()
    .projects.find((p) => p.id === createdProject.id);

  // Auto-focus the first worktree so cmd+t works immediately
  if (newProject && newProject.worktrees.length > 0) {
    activateWorktreeInScene(newProject.id, newProject.worktrees[0].id);
  }

  // Compute bounds from terminal positions
  let bx = 0,
    by = 0,
    bw = 340,
    bh = 200;
  if (newProject) {
    const terminals = newProject.worktrees.flatMap((w) =>
      w.terminals.filter((t) => !t.stashed),
    );
    if (terminals.length > 0) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const t of terminals) {
        minX = Math.min(minX, t.x);
        minY = Math.min(minY, t.y);
        maxX = Math.max(maxX, t.x + t.width);
        maxY = Math.max(maxY, t.y + t.height);
      }
      bx = minX;
      by = minY;
      bw = maxX - minX;
      bh = maxY - minY;
    }
  }
  const newProjectBounds = { x: bx, y: by, w: bw, h: bh };

  const {
    viewport: { scale },
    rightPanelCollapsed,
  } = useCanvasStore.getState();
  const rightOffset = getCanvasRightInset(rightPanelCollapsed);
  const screenCenterX = (window.innerWidth - rightOffset) / 2;
  const screenCenterY = window.innerHeight / 2;
  const targetX =
    -(newProjectBounds.x + newProjectBounds.w / 2) * scale + screenCenterX;
  const targetY =
    -(newProjectBounds.y + newProjectBounds.h / 2) * scale + screenCenterY;
  useCanvasStore.getState().animateTo(targetX, targetY, scale);
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
      const consumeShortcut = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (useSettingsModalStore.getState().open) {
        return;
      }

      if (shouldIgnoreShortcutTarget(e)) {
        return;
      }

      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        deleteSelectedSceneItems()
      ) {
        e.preventDefault();
        return;
      }

      if (matchesShortcut(e, shortcuts.addProject)) {
        consumeShortcut();
        handleAddProject(t);
        return;
      }

      if (matchesShortcut(e, shortcuts.clearFocus)) {
        consumeShortcut();
        const list = getAllTerminals();
        const focusedIdx = getFocusedTerminalIndex(list);

        if (focusedIdx !== -1) {
          const focused = list[focusedIdx];
          lastFocusedRef.current = {
            projectId: focused.projectId,
            worktreeId: focused.worktreeId,
            terminalId: focused.terminalId,
          };
          if (getZoomedOutTerminalId() === focused.terminalId) {
            zoomToTerminal(focused.terminalId);
            setZoomedOutTerminalId(null);
          } else {
            zoomToFitAll();
            setZoomedOutTerminalId(focused.terminalId);
          }
        } else if (lastFocusedRef.current) {
          // Not focused, has history → restore last focused terminal
          const restored = list.find(
            (item) => item.terminalId === lastFocusedRef.current?.terminalId,
          );
          if (restored) {
            activateTerminalInScene(
              restored.projectId,
              restored.worktreeId,
              restored.terminalId,
            );
            zoomToTerminal(restored.terminalId);
            setZoomedOutTerminalId(null);
          } else {
            lastFocusedRef.current = null;
            setZoomedOutTerminalId(null);
          }
        } else if (list.length > 0) {
          const first = list[0];
          lastFocusedRef.current = {
            projectId: first.projectId,
            worktreeId: first.worktreeId,
            terminalId: first.terminalId,
          };
          activateTerminalInScene(
            first.projectId,
            first.worktreeId,
            first.terminalId,
          );
          zoomToTerminal(first.terminalId);
          setZoomedOutTerminalId(null);
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.toggleRightPanel)) {
        consumeShortcut();
        const store = useCanvasStore.getState();
        store.setRightPanelCollapsed(!store.rightPanelCollapsed);
        return;
      }

      if (matchesShortcut(e, shortcuts.toggleStarFocused)) {
        consumeShortcut();
        const list = getAllTerminals();
        const focusedIdx = getFocusedTerminalIndex(list);
        if (focusedIdx !== -1) {
          const focused = list[focusedIdx];
          toggleTerminalStarredInScene(
            focused.projectId,
            focused.worktreeId,
            focused.terminalId,
          );
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.newTerminal)) {
        e.preventDefault();
        const { focusedProjectId, focusedWorktreeId } =
          useProjectStore.getState();
        if (focusedProjectId && focusedWorktreeId) {
          const terminal = createTerminalInScene({
            projectId: focusedProjectId,
            worktreeId: focusedWorktreeId,
          });
          focusTerminalInScene(terminal.id);
          panToTerminal(terminal.id, { preserveScale: true });
          if (getZoomedOutTerminalId() !== null) {
            setZoomedOutTerminalId(terminal.id);
          }
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.saveWorkspace)) {
        consumeShortcut();
        void snapshotStateWithRefresh().then((snap) => {
          const { workspacePath } = useWorkspaceStore.getState();

          if (workspacePath) {
            window.termcanvas.workspace
              .saveToPath(workspacePath, snap)
              .then(async () => {
                await window.termcanvas.state.save(snap);
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
                await window.termcanvas.state.save(snap);
                useWorkspaceStore.getState().markClean();
                updateWindowTitle();
              })
              .catch((err) => {
                useNotificationStore
                  .getState()
                  .notify("error", t.save_error(String(err)));
              });
          }
        });
        return;
      }

      if (matchesShortcut(e, shortcuts.saveWorkspaceAs)) {
        consumeShortcut();
        void snapshotStateWithRefresh().then((snap) => {
          window.termcanvas.workspace
            .save(snap)
            .then(async (savedPath) => {
              if (!savedPath) {
                return;
              }
              useWorkspaceStore.getState().setWorkspacePath(savedPath);
              await window.termcanvas.state.save(snap);
              useWorkspaceStore.getState().markClean();
              updateWindowTitle();
            })
            .catch((err) => {
              useNotificationStore
                .getState()
                .notify("error", t.save_error(String(err)));
            });
        });
        return;
      }

      if (matchesShortcut(e, shortcuts.renameTerminalTitle)) {
        consumeShortcut();
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
        const worktree = project?.worktrees.find(
          (w) => w.id === focused.worktreeId,
        );
        const terminal = worktree?.terminals.find(
          (term) => term.id === focused.terminalId,
        );
        if (!terminal) {
          useNotificationStore
            .getState()
            .notify("warn", t.composer_rename_title_missing_target);
          return;
        }

        const { composerEnabled } = usePreferencesStore.getState();
        if (composerEnabled) {
          focusTerminalInScene(terminal.id);
          useComposerStore
            .getState()
            .enterRenameTerminalTitleMode(
              terminal.id,
              terminal.customTitle ?? "",
            );
        } else {
          focusTerminalInScene(terminal.id, { focusComposer: false });
          window.dispatchEvent(
            new CustomEvent("termcanvas:focus-custom-title", {
              detail: terminal.id,
            }),
          );
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.closeFocused)) {
        consumeShortcut();
        // cmd+d is the inverse of cmd+t. cmd+t (terminalPlacement.ts) inserts
        // a new tile at (focused.right + gap, focused.y) inside the focused
        // worktree, so cmd+d closes the focused tile and lands focus on its
        // spatial-LEFT neighbor in the same worktree — pressing cmd+t then
        // cmd+d round-trips to the original tile. The fallback chain stays
        // strictly inside worktree → project → cross-project so users are
        // never silently kicked out of the project they were working in.
        const projects = useProjectStore.getState().projects;
        const focused = findFocusedTerminalLocation(projects);
        if (!focused) return;

        const nextFocusedTerminalId = pickCloseFocusTarget(
          projects,
          focused.terminalId,
        );

        closeTerminalInScene(
          focused.projectId,
          focused.worktreeId,
          focused.terminalId,
        );

        if (nextFocusedTerminalId) {
          setZoomedOutTerminalId(
            navigateToTerminalWithViewport(nextFocusedTerminalId, {
              zoomedOutTerminalId: getZoomedOutTerminalId(),
            }),
          );
        } else {
          setZoomedOutTerminalId(null);
        }
        return;
      }

      if (matchesShortcut(e, shortcuts.cycleFocusLevel)) {
        consumeShortcut();
        useCanvasStore.getState().cycleFocusLevel();
        return;
      }

      if (matchesShortcut(e, shortcuts.nextTerminal)) {
        consumeShortcut();
        const level = useCanvasStore.getState().focusLevel;

        if (level === "worktree") {
          const list = getAllWorktrees();
          if (list.length === 0) return;
          const currentIndex = getFocusedWorktreeIndex(list);
          const nextIndex =
            currentIndex === -1 ? 0 : (currentIndex + 1) % list.length;
          const next = list[nextIndex];
          focusWorktreeInScene(next.projectId, next.worktreeId);
          panToWorktree(next.projectId, next.worktreeId);
          return;
        }

        const terminalList =
          level === "starred"
            ? getStarredTerminalsSpatial()
            : getAllTerminalsSpatial();

        if (terminalList.length === 0) return;
        const currentIndex = getFocusedTerminalIndex(terminalList);
        const nextIndex =
          currentIndex === -1 ? 0 : (currentIndex + 1) % terminalList.length;
        const next = terminalList[nextIndex];
        focusTerminalInScene(next.terminalId);
        setZoomedOutTerminalId(
          navigateToTerminalWithViewport(next.terminalId, {
            zoomedOutTerminalId: getZoomedOutTerminalId(),
          }),
        );
        return;
      }

      if (matchesShortcut(e, shortcuts.prevTerminal)) {
        consumeShortcut();
        const level = useCanvasStore.getState().focusLevel;

        if (level === "worktree") {
          const list = getAllWorktrees();
          if (list.length === 0) return;
          const currentIndex = getFocusedWorktreeIndex(list);
          const prevIndex =
            currentIndex <= 0 ? list.length - 1 : currentIndex - 1;
          const prev = list[prevIndex];
          focusWorktreeInScene(prev.projectId, prev.worktreeId);
          panToWorktree(prev.projectId, prev.worktreeId);
          return;
        }

        const terminalList =
          level === "starred"
            ? getStarredTerminalsSpatial()
            : getAllTerminalsSpatial();

        if (terminalList.length === 0) return;
        const currentIndex = getFocusedTerminalIndex(terminalList);
        const prevIndex =
          currentIndex <= 0 ? terminalList.length - 1 : currentIndex - 1;
        const prev = terminalList[prevIndex];
        focusTerminalInScene(prev.terminalId);
        setZoomedOutTerminalId(
          navigateToTerminalWithViewport(prev.terminalId, {
            zoomedOutTerminalId: getZoomedOutTerminalId(),
          }),
        );
        return;
      }

    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [shortcuts, t]);
}
