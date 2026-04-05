import { clearSceneSelection } from "./actions/sceneSelectionActions";
import { restoreBrowserCardsInScene } from "./actions/sceneCardActions";
import { getStashedTerminals, useProjectStore } from "./stores/projectStore";
import { useCanvasStore } from "./stores/canvasStore";
import { useDrawingStore } from "./stores/drawingStore";
import { useBrowserCardStore } from "./stores/browserCardStore";
import { useFileCardStore } from "./stores/fileCardStore";
import { useStashStore } from "./stores/stashStore";
import { useTerminalRuntimeStateStore } from "./stores/terminalRuntimeStateStore";
import {
  destroyAllTerminalRuntimes,
  refreshClaudeSessionStates,
  serializeAllTerminalRuntimeBuffers,
} from "./terminal/terminalRuntimeStore";
import { clearTerminalGeometryRegistry } from "./terminal/terminalGeometryRegistry";
import { logSlowRendererPath } from "./utils/devPerf";
import { normalizeProjectsFocus } from "./stores/projectFocus";
import {
  readWorkspaceSnapshot,
  type RestoredWorkspaceSnapshot,
  type SkipRestoreSnapshot,
  type SceneWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "./snapshotBridge";
import {
  buildSceneDocument,
  sceneDocumentToLegacyState,
} from "./canvas/sceneProjection";
import {
  toPersistedProjectData,
  restorePersistedStashedTerminal,
  toPersistedStashedTerminal,
} from "./canvas/scenePersistence";

export function restoreWorkspaceSnapshot(
  snapshot: RestoredWorkspaceSnapshot,
) {
  const restoredState = sceneDocumentToLegacyState(snapshot.scene);
  destroyAllTerminalRuntimes();
  useTerminalRuntimeStateStore.getState().reset();
  clearTerminalGeometryRegistry();
  clearSceneSelection();
  useCanvasStore.getState().restoreViewport(restoredState.viewport);
  useProjectStore.setState(
    normalizeProjectsFocus(restoredState.projects),
  );
  useDrawingStore.setState({
    elements: restoredState.drawings,
  });
  restoreBrowserCardsInScene(restoredState.browserCards);
  useFileCardStore.getState().clear();
  useStashStore.getState().setItems(
    (snapshot.scene.stashedTerminals ?? []).map(restorePersistedStashedTerminal),
  );
}

export {
  type LegacyWorkspaceSnapshot,
  readWorkspaceSnapshot,
  type RestoredWorkspaceSnapshot,
  type SkipRestoreSnapshot,
  type SceneWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "./snapshotBridge";

function buildSceneWorkspaceSnapshot(): SceneWorkspaceSnapshot {
  const startedAt = performance.now();
  const scrollbacks = serializeAllTerminalRuntimeBuffers();
  const projects = useProjectStore.getState().projects.map((project) =>
    toPersistedProjectData(project, scrollbacks),
  );

  const stashedTerminals = getStashedTerminals().map((entry) =>
    toPersistedStashedTerminal(entry, scrollbacks),
  );

  const scene = buildSceneDocument({
    viewport: useCanvasStore.getState().viewport,
    projects,
    drawings: useDrawingStore.getState().elements,
    browserCards: useBrowserCardStore.getState().cards,
    stashedTerminals,
  });

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

  return {
    version: 2,
    scene,
  };
}

export function buildSnapshotState(): SceneWorkspaceSnapshot {
  return buildSceneWorkspaceSnapshot();
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

/**
 * Refresh live Claude session states (sessionId + permissionMode) from
 * disk, then build and serialize the snapshot.  Use this instead of
 * snapshotState() when the save is user-initiated or happens at close
 * time, so /resume switches and permission toggles are captured.
 */
export async function snapshotStateWithRefresh(): Promise<string> {
  await refreshClaudeSessionStates();
  return snapshotState();
}
