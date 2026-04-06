import { clearSceneSelection } from "./actions/sceneSelectionActions";
import { restoreBrowserCardsInScene } from "./actions/sceneCardActions";
import { useProjectStore } from "./stores/projectStore";
import { useCanvasStore } from "./stores/canvasStore";
import { useDrawingStore } from "./stores/drawingStore";
import { useBrowserCardStore } from "./stores/browserCardStore";
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
} from "./canvas/scenePersistence";
import type { ProjectData, StashedTerminal } from "./types";

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

function deriveStashItemsFromProjects(projects: ProjectData[]): StashedTerminal[] {
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

export function restoreWorkspaceSnapshot(
  snapshot: RestoredWorkspaceSnapshot,
) {
  const restoredState = sceneDocumentToLegacyState(snapshot.scene);
  const restoredProjects = mergeStashedTerminalsIntoProjects(
    restoredState.projects,
    restoredState.stashedTerminals,
  );
  destroyAllTerminalRuntimes();
  useTerminalRuntimeStateStore.getState().reset();
  clearTerminalGeometryRegistry();
  clearSceneSelection();
  useCanvasStore.getState().restoreViewport(restoredState.viewport);
  useProjectStore.setState(
    normalizeProjectsFocus(restoredProjects),
  );
  useDrawingStore.setState({
    elements: restoredState.drawings,
  });
  restoreBrowserCardsInScene(restoredState.browserCards);
  useStashStore.getState().setItems(deriveStashItemsFromProjects(restoredProjects));
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

  const scene = buildSceneDocument({
    viewport: useCanvasStore.getState().viewport,
    projects,
    drawings: useDrawingStore.getState().elements,
    browserCards: useBrowserCardStore.getState().cards,
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
