import { useCanvasRegistryStore } from "./stores/canvasRegistryStore";
import { applyCanvasSceneToLive } from "./canvas/canvasSceneIO";
import { logSlowRendererPath } from "./utils/devPerf";
import {
  readWorkspaceSnapshot,
  type RestoredWorkspaceSnapshot,
  type SkipRestoreSnapshot,
  type SceneWorkspaceSnapshot,
  type MultiCanvasWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "./snapshotBridge";
import {
  refreshClaudeSessionStates,
} from "./terminal/terminalRuntimeStore";

export function restoreWorkspaceSnapshot(
  snapshot: RestoredWorkspaceSnapshot,
) {
  const workspace = snapshot.workspace ?? wrapSceneAsDefaultWorkspace(snapshot.scene);
  useCanvasRegistryStore
    .getState()
    .hydrate(workspace.canvases, workspace.activeCanvasId);
  applyCanvasSceneToLive(snapshot.scene);
}

function wrapSceneAsDefaultWorkspace(
  scene: RestoredWorkspaceSnapshot["scene"],
) {
  const id = `canvas-default-${Date.now().toString(36)}`;
  return {
    version: 3 as const,
    activeCanvasId: id,
    canvases: [
      {
        id,
        name: "Default",
        createdAt: Date.now(),
        scene,
      },
    ],
  };
}

export {
  type LegacyWorkspaceSnapshot,
  readWorkspaceSnapshot,
  type RestoredWorkspaceSnapshot,
  type SkipRestoreSnapshot,
  type SceneWorkspaceSnapshot,
  type MultiCanvasWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "./snapshotBridge";

function buildMultiCanvasSnapshot(): MultiCanvasWorkspaceSnapshot {
  const startedAt = performance.now();
  const canvases = useCanvasRegistryStore.getState().syncActiveFromLive();
  const { activeCanvasId } = useCanvasRegistryStore.getState();
  const active =
    canvases.find((c) => c.id === activeCanvasId) ?? canvases[0];

  logSlowRendererPath("snapshotState.build", startedAt, {
    thresholdMs: 20,
    details: {
      canvases: canvases.length,
      activeProjects: active.scene.projects.length,
    },
  });

  return {
    version: 3,
    workspace: {
      version: 3,
      activeCanvasId: active.id,
      canvases,
    },
    scene: active.scene,
  };
}

export function buildSnapshotState(): MultiCanvasWorkspaceSnapshot {
  return buildMultiCanvasSnapshot();
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
