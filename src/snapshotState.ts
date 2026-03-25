import { useProjectStore } from "./stores/projectStore";
import { useCanvasStore } from "./stores/canvasStore";
import { useDrawingStore } from "./stores/drawingStore";
import { useBrowserCardStore } from "./stores/browserCardStore";
import { useSelectionStore } from "./stores/selectionStore";
import {
  destroyAllTerminalRuntimes,
  serializeAllTerminalRuntimeBuffers,
} from "./terminal/terminalRuntimeStore";
import { clearTerminalGeometryRegistry } from "./terminal/terminalGeometryRegistry";
import { logSlowRendererPath } from "./utils/devPerf";
import { normalizeProjectsFocus } from "./stores/projectFocus";
import {
  type LegacyWorkspaceSnapshot,
  readWorkspaceSnapshot,
  type RestoredWorkspaceSnapshot,
  type SkipRestoreSnapshot,
  type SceneWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "./snapshotBridge";
import {
  buildSceneDocumentFromLegacyState,
  sceneDocumentToLegacyState,
} from "./canvas/sceneProjection";

export function restoreWorkspaceSnapshot(
  snapshot: RestoredWorkspaceSnapshot,
) {
  const restoredState = sceneDocumentToLegacyState(snapshot.scene);
  destroyAllTerminalRuntimes();
  clearTerminalGeometryRegistry();
  useSelectionStore.getState().clearSelection();
  useCanvasStore.getState().restoreViewport(restoredState.viewport);
  useProjectStore.setState(
    normalizeProjectsFocus(restoredState.projects),
  );
  useDrawingStore.setState({
    elements: restoredState.drawings,
  });
  useBrowserCardStore.setState({
    cards: restoredState.browserCards,
  });
}

export {
  type LegacyWorkspaceSnapshot,
  readWorkspaceSnapshot,
  type RestoredWorkspaceSnapshot,
  type SkipRestoreSnapshot,
  type SceneWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "./snapshotBridge";

function buildLegacyWorkspaceSnapshot(): LegacyWorkspaceSnapshot {
  const startedAt = performance.now();
  const scrollbacks = serializeAllTerminalRuntimeBuffers();
  const projects = useProjectStore.getState().projects.map((project) => ({
    ...project,
    worktrees: project.worktrees.map((worktree) => ({
      ...worktree,
      terminals: worktree.terminals.map((terminal) => ({
        ...terminal,
        scrollback:
          scrollbacks[terminal.id] ?? terminal.scrollback ?? undefined,
        ptyId: null,
      })),
    })),
  }));

  const snapshot = {
    version: 1 as const,
    viewport: useCanvasStore.getState().viewport,
    projects,
    drawings: useDrawingStore.getState().elements,
    browserCards: useBrowserCardStore.getState().cards,
  };

  logSlowRendererPath("snapshotState.build", startedAt, {
    thresholdMs: 20,
    details: {
      projects: projects.length,
      terminals: projects.reduce(
        (count, project) =>
          count +
          project.worktrees.reduce(
            (worktreeCount, worktree) =>
              worktreeCount + worktree.terminals.length,
            0,
          ),
        0,
      ),
    },
  });

  return snapshot;
}

export function buildSnapshotState(): SceneWorkspaceSnapshot {
  const legacySnapshot = buildLegacyWorkspaceSnapshot();
  return {
    version: 2,
    scene: buildSceneDocumentFromLegacyState(legacySnapshot),
  };
}

export function snapshotState(): string {
  const startedAt = performance.now();
  const serialized = JSON.stringify(buildSnapshotState(), null, 2);
  logSlowRendererPath("snapshotState.serialize", startedAt, {
    thresholdMs: 20,
    details: { bytes: serialized.length },
  });
  return serialized;
}
