/**
 * Capture/apply helpers for swapping the live stores between canvases.
 *
 * `captureLiveCanvasScene` reads the current state of all per-canvas
 * stores (projects, viewport, drawings, browser cards, stash) and packs
 * it into a SceneDocument. `applyCanvasSceneToLive` does the inverse —
 * loads a SceneDocument back into the live stores.
 *
 * Why a separate function from `restoreWorkspaceSnapshot`: full restore
 * destroys every PTY runtime (it's used for app boot and history
 * rollback). Canvas switching wants the same in-place swap *without*
 * killing terminals on the canvas being left behind — but we're not
 * there yet. For v1, switching reuses the destroy-and-rebuild path so
 * there are no PTY leaks. The split exists so a future iteration can
 * keep PTYs alive across switches without reworking the snapshot
 * pipeline.
 */
import { clearSceneSelection } from "../actions/sceneSelectionActions";
import { restoreBrowserCardsInScene } from "../actions/sceneCardActions";
import { useBrowserCardStore } from "../stores/browserCardStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useDrawingStore } from "../stores/drawingStore";
import { useProjectStore } from "../stores/projectStore";
import { useStashStore } from "../stores/stashStore";
import { useTerminalRuntimeStateStore } from "../stores/terminalRuntimeStateStore";
import {
  destroyAllTerminalRuntimes,
  serializeAllTerminalRuntimeBuffers,
} from "../terminal/terminalRuntimeStore";
import { clearTerminalGeometryRegistry } from "../terminal/terminalGeometryRegistry";
import { normalizeProjectsFocus } from "../stores/projectFocus";
import {
  buildSceneDocument,
  sceneDocumentToLegacyState,
} from "./sceneProjection";
import { toPersistedProjectData } from "./scenePersistence";
import type { SceneDocument } from "../types/scene";
import type { ProjectData, StashedTerminal } from "../types";

function mergeStashedTerminalsIntoProjects(
  projects: ProjectData[],
  stashedTerminals: StashedTerminal[],
): ProjectData[] {
  if (stashedTerminals.length === 0) {
    return projects;
  }

  const entriesByWorktree = new Map<string, StashedTerminal[]>();
  for (const entry of stashedTerminals) {
    const key = `${entry.projectId}:${entry.worktreeId}`;
    const entries = entriesByWorktree.get(key) ?? [];
    entries.push(entry);
    entriesByWorktree.set(key, entries);
  }

  let changed = false;
  const mergedProjects = projects.map((project) => {
    let projectChanged = false;
    const worktrees = project.worktrees.map((worktree) => {
      const entries = entriesByWorktree.get(`${project.id}:${worktree.id}`);
      if (!entries || entries.length === 0) {
        return worktree;
      }

      const existingTerminalIds = new Set(
        worktree.terminals.map((terminal) => terminal.id),
      );
      const missingTerminals = entries
        .filter((entry) => !existingTerminalIds.has(entry.terminal.id))
        .map((entry) => ({
          ...entry.terminal,
          focused: false,
          stashed: true,
          stashedAt: entry.stashedAt,
        }));
      if (missingTerminals.length === 0) {
        return worktree;
      }

      changed = true;
      projectChanged = true;
      return {
        ...worktree,
        terminals: [...worktree.terminals, ...missingTerminals],
      };
    });

    return projectChanged ? { ...project, worktrees } : project;
  });

  return changed ? mergedProjects : projects;
}

function deriveStashItemsFromProjects(
  projects: ProjectData[],
): StashedTerminal[] {
  return projects.flatMap((project) =>
    project.worktrees.flatMap((worktree) =>
      worktree.terminals.flatMap((terminal) =>
        terminal.stashed
          ? [
              {
                projectId: project.id,
                worktreeId: worktree.id,
                stashedAt: terminal.stashedAt ?? 0,
                terminal,
              },
            ]
          : [],
      ),
    ),
  );
}

/**
 * Read the current state of every per-canvas store and pack it into a
 * SceneDocument. Includes any live PTY scrollback so when this scene is
 * later restored, terminals come back with the text they had on screen.
 */
export function captureLiveCanvasScene(): SceneDocument {
  const scrollbacks = serializeAllTerminalRuntimeBuffers();
  const projects = useProjectStore.getState().projects.map((project) =>
    toPersistedProjectData(project, scrollbacks),
  );

  return buildSceneDocument({
    viewport: useCanvasStore.getState().viewport,
    projects,
    drawings: useDrawingStore.getState().elements,
    browserCards: useBrowserCardStore.getState().cards,
  });
}

/**
 * Apply a SceneDocument to the live stores. Mirrors restoreWorkspaceSnapshot
 * but stays in this module so the canvas-switch path can be tuned
 * independently if we later teach it to keep PTYs alive across switches.
 */
export function applyCanvasSceneToLive(scene: SceneDocument) {
  const restored = sceneDocumentToLegacyState(scene);
  const restoredProjects = mergeStashedTerminalsIntoProjects(
    restored.projects,
    restored.stashedTerminals,
  );
  destroyAllTerminalRuntimes();
  useTerminalRuntimeStateStore.getState().reset();
  clearTerminalGeometryRegistry();
  clearSceneSelection();
  useCanvasStore.getState().restoreViewport(restored.viewport);
  useProjectStore.setState(normalizeProjectsFocus(restoredProjects));
  useDrawingStore.setState({ elements: restored.drawings });
  restoreBrowserCardsInScene(restored.browserCards);
  useStashStore
    .getState()
    .setItems(deriveStashItemsFromProjects(restoredProjects));
}
