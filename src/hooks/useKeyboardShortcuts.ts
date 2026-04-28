import { useEffect } from "react";
import { useViewportFocusStore } from "../stores/viewportFocusStore";
import { deleteSelectedSceneItems } from "../actions/sceneDeleteActions";
import {
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
import { useCanvasToolStore } from "../stores/canvasToolStore";
import {
  fitAllProjects,
  setZoomToHundred,
  stepZoomAtCenter,
} from "../canvas/zoomActions";
import { useNotificationStore } from "../stores/notificationStore";
import { promptAndAddProjectToScene } from "../canvas/sceneCommands";
import { useShortcutStore, matchesShortcut } from "../stores/shortcutStore";
import { useTerminalFindStore } from "../stores/terminalFindStore";
import { useT } from "../i18n/useT";
import { useComposerStore } from "../stores/composerStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useSearchStore } from "../stores/searchStore";
import { useCommandPaletteStore } from "../stores/commandPaletteStore";
import { useSnapshotHistoryStore } from "../stores/snapshotHistoryStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsModalStore } from "../stores/settingsModalStore";
import {
  getSpatialTerminalOrder,
  getTerminalFocusOrder,
  getWorktreeFocusOrder,
} from "../stores/projectFocus";
import { pickCloseFocusTarget } from "../canvas/closeFocusTarget";
import {
  isActivationTarget,
  isEditableTarget,
  shouldIgnoreShortcutTarget,
} from "./shortcutTarget";
import { snapshotStateWithRefresh } from "../snapshotState";
import { updateWindowTitle } from "../titleHelper";
import { panToTerminal } from "../utils/panToTerminal";
import { panToWorktree } from "../utils/panToWorktree";
import { toggleClearFocus } from "../canvas/toggleClearFocus";
import { recordRenderDiagnostic } from "../terminal/renderDiagnostics";
import {
  getCanvasRightInset,
  getCanvasLeftInset,
} from "../canvas/viewportBounds";
import { usePinStore } from "../stores/pinStore";
import {
  isWaypointSlot,
  recallWaypointFromActiveProject,
  saveWaypointToActiveProject,
} from "../actions/spatialWaypointActions";
import { panToRecentActivity } from "../actions/recentActivityNavigationAction";
import { useStatusDigestStore } from "../stores/statusDigestStore";
import { useHubStore } from "../stores/hubStore";
import { useCanvasRegistryStore } from "../stores/canvasRegistryStore";
import { useCanvasManagerStore } from "../stores/canvasManagerStore";

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
  const keepScale = options.zoomedOutTerminalId !== null;

  recordRenderDiagnostic({
    kind: "navigate_terminal_with_viewport",
    terminalId,
    data: {
      preserve_scale: keepScale,
      zoomed_out_terminal_id: options.zoomedOutTerminalId,
    },
  });

  if (keepScale) {
    pan(terminalId, { preserveScale: true });
    return terminalId;
  }

  zoom(terminalId);
  return null;
}

function zoomToFitAll() {
  const { projects } = useProjectStore.getState();
  const {
    rightPanelCollapsed,
    rightPanelWidth,
    leftPanelCollapsed,
    leftPanelWidth,
  } = useCanvasStore.getState();
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
  const rightOffset = getCanvasRightInset(rightPanelCollapsed, rightPanelWidth);
  const leftOffset = getCanvasLeftInset(
    leftPanelCollapsed,
    leftPanelWidth,
    usePinStore.getState().openProjectPath !== null,
  );
  const viewW = window.innerWidth - leftOffset - rightOffset - padding * 2;
  const viewH = window.innerHeight - toolbarH - padding * 2;
  const scale = Math.min(1, viewW / contentW, viewH / contentH);
  useViewportFocusStore.getState().setFitAllScale(scale);
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
    rightPanelWidth,
  } = useCanvasStore.getState();
  const rightOffset = getCanvasRightInset(rightPanelCollapsed, rightPanelWidth);
  const screenCenterX = (window.innerWidth - rightOffset) / 2;
  const screenCenterY = window.innerHeight / 2;
  const targetX =
    -(newProjectBounds.x + newProjectBounds.w / 2) * scale + screenCenterX;
  const targetY =
    -(newProjectBounds.y + newProjectBounds.h / 2) * scale + screenCenterY;
  useCanvasStore.getState().animateTo(targetX, targetY, scale);
}

export function useKeyboardShortcuts() {
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const t = useT();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const consumeShortcut = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      // Settings toggle (⌘, on macOS, Ctrl+, elsewhere). Stays bound
      // even while the modal is open so the same chord that opens it
      // also closes it — matches the OS-level convention. Comma is not
      // a shortcut character users type into terminals or text fields,
      // so we don't gate this on focus target.
      const isSettingsToggle =
        e.key === "," &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey;
      if (isSettingsToggle) {
        consumeShortcut();
        const settingsStore = useSettingsModalStore.getState();
        if (settingsStore.open) settingsStore.closeSettings();
        else settingsStore.openSettings();
        return;
      }

      if (useSettingsModalStore.getState().open) {
        return;
      }

      // Global search — must be before shouldIgnoreShortcutTarget so it works from terminal focus
      if (matchesShortcut(e, shortcuts.globalSearch)) {
        if (usePreferencesStore.getState().globalSearchEnabled) {
          consumeShortcut();
          const searchStore = useSearchStore.getState();
          if (searchStore.open) searchStore.closeSearch();
          else searchStore.openSearch();
        }
        return;
      }

      // Command palette — Cmd/Ctrl+P, "go to / run anything". Must be
      // before shouldIgnoreShortcutTarget so it triggers from terminal
      // focus the same way globalSearch does. preventDefault here is
      // also what disarms the browser/print binding on the same combo.
      if (matchesShortcut(e, shortcuts.commandPalette)) {
        consumeShortcut();
        useCommandPaletteStore.getState().togglePalette();
        return;
      }

      // Usage overlay — same "works from terminal focus" treatment as
      // search. Shift-modifier means a plain "u" keystroke inside the
      // terminal is never swallowed.
      if (matchesShortcut(e, shortcuts.toggleUsageOverlay)) {
        consumeShortcut();
        useCanvasStore.getState().toggleUsageOverlay();
        return;
      }

      // Sessions overlay — same treatment. Cmd+Shift+H ("history").
      // Kept off Cmd+Shift+S because mod+shift+s is saveWorkspaceAs.
      if (matchesShortcut(e, shortcuts.toggleSessionsOverlay)) {
        consumeShortcut();
        useCanvasStore.getState().toggleSessionsOverlay();
        return;
      }

      // Snapshot history browser — Cmd+Shift+T ("time"). Sessions overlay
      // shows agent transcripts; this surface lists canvas-state snapshots
      // and lets the user roll the scene back. Same "works from terminal
      // focus" treatment as the rest of this block.
      if (matchesShortcut(e, shortcuts.toggleSnapshotHistory)) {
        consumeShortcut();
        useSnapshotHistoryStore.getState().toggleHistory();
        return;
      }

      // Activity heatmap — Cmd+Shift+A flips the canvas-wide ambient
      // indicator on. Read from terminal focus too so the user can
      // toggle without leaving an agent tile.
      if (matchesShortcut(e, shortcuts.toggleActivityHeatmap)) {
        consumeShortcut();
        const prefs = usePreferencesStore.getState();
        prefs.setActivityHeatmapEnabled(!prefs.activityHeatmapEnabled);
        return;
      }

      // Hub — Cmd+Shift+J slides the command-center drawer in/out.
      // Treated like the search/palette shortcut: works from terminal
      // focus so power-users can summon it without breaking flow.
      if (matchesShortcut(e, shortcuts.toggleHub)) {
        consumeShortcut();
        useHubStore.getState().toggleHub();
        return;
      }

      // Canvas cycle — Cmd+Shift+] / Cmd+Shift+[ moves to the next /
      // prev named canvas. Sister to nextTerminal/prevTerminal which
      // own the unshifted chord; the shift modifier promotes the
      // navigation a tier (terminal → canvas) without sacrificing
      // muscle memory. Works from terminal focus so the chord that
      // changes "rooms" never has to wait for focus to leave the tile.
      if (matchesShortcut(e, shortcuts.nextCanvas)) {
        consumeShortcut();
        useCanvasRegistryStore.getState().cycleCanvas(1);
        return;
      }
      if (matchesShortcut(e, shortcuts.prevCanvas)) {
        consumeShortcut();
        useCanvasRegistryStore.getState().cycleCanvas(-1);
        return;
      }
      if (matchesShortcut(e, shortcuts.openCanvasManager)) {
        consumeShortcut();
        useCanvasManagerStore.getState().openManager();
        return;
      }

      // Status digest. Cmd/Ctrl+Shift+/ pops a quiet floating chip
      // listing the 3–5 most relevant signals across the canvas (just-
      // completed runs, stuck agents, busy ones, the current focus,
      // pinned terminals). Match on e.code so layouts that map Shift+/
      // to "?" still trigger. Skip when focus is in an editable target
      // so terminals/text fields keep the keystroke. Chord position-
      // wise sits next to mod+/ (toggleRightPanel) — same key, with
      // shift adds the "summary" layer.
      if (
        e.code === "Slash" &&
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        !e.altKey &&
        !e.repeat &&
        !isEditableTarget(e.target)
      ) {
        consumeShortcut();
        const digest = useStatusDigestStore.getState();
        if (digest.open) digest.closeDigest();
        else digest.openDigest();
        return;
      }

      // Pan-to-recent-activity. Alt+` flies the camera to whichever
      // terminal emitted PTY output most recently (within last 30s).
      // Repeated rapid presses cycle through an LRU snapshot, Alt+Tab
      // style. Use e.code so Option+` (which yields a dead-key on
      // macOS layouts) still matches. Skip when focus is in an editable
      // target so the keystroke isn't stolen from terminal text input.
      if (
        e.code === "Backquote" &&
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.repeat &&
        !isEditableTarget(e.target)
      ) {
        consumeShortcut();
        panToRecentActivity();
        return;
      }

      // Spatial waypoints. Cmd/Ctrl+Shift+1..9 saves the current
      // viewport to that slot; Alt+1..9 jumps to a saved waypoint
      // with a smooth camera move. Use e.code so layout-dependent
      // characters (Option+1 → ¡ on macOS, Shift+1 → "!") don't
      // break the match. Skip when focus is in an editable target so
      // terminal / textarea text input keeps the keystroke.
      //
      // Recall uses Alt+digit instead of the more obvious Cmd+digit
      // because Cmd+1 is already taken by Figma-style zoom-to-100%
      // — keeping the Cmd+0 / Cmd+1 zoom pair intact preserves the
      // canvas mental model. Single-modifier recall is also faster
      // than two-modifier save, which matches usage frequency
      // (recall happens often, save rarely).
      if (!isEditableTarget(e.target) && !e.repeat) {
        const digitMatch = /^Digit([1-9])$/.exec(e.code);
        if (digitMatch) {
          const slot = digitMatch[1];
          if (isWaypointSlot(slot)) {
            const isSaveCombo =
              (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey;
            const isRecallCombo =
              e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey;
            if (isSaveCombo) {
              consumeShortcut();
              saveWaypointToActiveProject(slot);
              return;
            }
            if (isRecallCombo) {
              consumeShortcut();
              recallWaypointFromActiveProject(slot);
              return;
            }
          }
        }
      }

      // Figma-style canvas zoom: Cmd+0 fit, Cmd+1 100%, Cmd+= / Cmd+-
      // step. Skip when focus is in an editable target so Monaco /
      // textareas / inputs keep their own Cmd+0/=/- semantics —
      // shouldIgnoreShortcutTarget alone doesn't gate these because
      // the modifier flips its check off.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !isEditableTarget(e.target)) {
        if (e.key === "0") {
          consumeShortcut();
          fitAllProjects();
          return;
        }
        if (e.key === "1" && !e.shiftKey) {
          consumeShortcut();
          setZoomToHundred();
          return;
        }
        // Browsers map Cmd++ → Cmd+= and Cmd+- to zoom; we override.
        if (e.key === "=" || e.key === "+") {
          consumeShortcut();
          stepZoomAtCenter("in");
          return;
        }
        if (e.key === "-" || e.key === "_") {
          consumeShortcut();
          stepZoomAtCenter("out");
          return;
        }
      }

      if (shouldIgnoreShortcutTarget(e)) {
        return;
      }

      // Shift+1 → fit all (Figma "fit content"). After
      // shouldIgnoreShortcutTarget so it can't hijack "!" in editable
      // fields.
      if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === "Digit1") {
        consumeShortcut();
        fitAllProjects();
        return;
      }

      // V / H — switch canvas tool. No modifiers; fall through if any
      // modifier is held so things like Cmd+H (hide on macOS) survive.
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.repeat
      ) {
        const key = e.key.toLowerCase();
        if (key === "v") {
          consumeShortcut();
          useCanvasToolStore.getState().setTool("select");
          return;
        }
        if (key === "h") {
          consumeShortcut();
          useCanvasToolStore.getState().setTool("hand");
          return;
        }
      }

      // Space hold → temporary hand. Handled outside !e.repeat so that
      // e.preventDefault() fires on every Space keydown (including
      // repeats), preventing browser scroll while held. setSpaceHeld is
      // only called once via the !spaceHeld guard. Skip when the focused
      // control natively activates on Space (button, menu item, …) so
      // keyboard operation of the toolbar itself is preserved.
      if (
        e.code === "Space" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        if (isActivationTarget(e.target)) {
          return;
        }
        if (!useCanvasToolStore.getState().spaceHeld) {
          useCanvasToolStore.getState().setSpaceHeld(true);
        }
        e.preventDefault();
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
        toggleClearFocus();
        return;
      }

      // `toggleRightPanel` (Cmd+/) collapses/expands the right panel
      // — which now hosts the Files/Diff/Git/Memory tabs (it used to
      // live on the left before project management moved there).
      if (matchesShortcut(e, shortcuts.toggleRightPanel)) {
        consumeShortcut();
        const s = useCanvasStore.getState();
        s.setRightPanelCollapsed(!s.rightPanelCollapsed);
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

      if (
        matchesShortcut(e, shortcuts.openTerminalFind) &&
        !isEditableTarget(e.target)
      ) {
        consumeShortcut();
        const list = getAllTerminals();
        const focusedIdx = getFocusedTerminalIndex(list);
        if (focusedIdx !== -1) {
          useTerminalFindStore
            .getState()
            .openFor(list[focusedIdx].terminalId);
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
        recordRenderDiagnostic({
          kind: "shortcut_cycle_terminal",
          terminalId: next.terminalId,
          data: {
            current_terminal_id:
              currentIndex === -1
                ? null
                : terminalList[currentIndex]?.terminalId ?? null,
            direction: "next",
            focus_level: level,
            terminal_count: terminalList.length,
          },
        });
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
        recordRenderDiagnostic({
          kind: "shortcut_cycle_terminal",
          terminalId: prev.terminalId,
          data: {
            current_terminal_id:
              currentIndex === -1
                ? null
                : terminalList[currentIndex]?.terminalId ?? null,
            direction: "prev",
            focus_level: level,
            terminal_count: terminalList.length,
          },
        });
        focusTerminalInScene(prev.terminalId);
        setZoomedOutTerminalId(
          navigateToTerminalWithViewport(prev.terminalId, {
            zoomedOutTerminalId: getZoomedOutTerminalId(),
          }),
        );
        return;
      }
    };

    // Release temp-pan when Space lifts. Listening on keyup directly
    // (rather than threading through `handler`) keeps the release path
    // independent of focus checks — if focus shifted into an editable
    // field mid-hold, we still want the panning state to clear.
    const releaseSpacePan = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (useCanvasToolStore.getState().spaceHeld) {
        useCanvasToolStore.getState().setSpaceHeld(false);
      }
    };
    const releaseOnBlur = () => {
      if (useCanvasToolStore.getState().spaceHeld) {
        useCanvasToolStore.getState().setSpaceHeld(false);
      }
    };

    window.addEventListener("keydown", handler, true);
    window.addEventListener("keyup", releaseSpacePan, true);
    window.addEventListener("blur", releaseOnBlur);
    return () => {
      window.removeEventListener("keydown", handler, true);
      window.removeEventListener("keyup", releaseSpacePan, true);
      window.removeEventListener("blur", releaseOnBlur);
    };
  }, [shortcuts, t]);
}
