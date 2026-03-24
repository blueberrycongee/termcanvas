import { useProjectStore } from "./stores/projectStore";
import { useCanvasStore } from "./stores/canvasStore";
import { useDrawingStore } from "./stores/drawingStore";
import { useBrowserCardStore } from "./stores/browserCardStore";
import { serializeAllTerminals } from "./terminal/terminalRegistry";
import { logSlowRendererPath } from "./utils/devPerf";

export interface WorkspaceSnapshot {
  version: number;
  viewport: ReturnType<typeof useCanvasStore.getState>["viewport"];
  projects: ReturnType<typeof useProjectStore.getState>["projects"];
  drawings: ReturnType<typeof useDrawingStore.getState>["elements"];
  browserCards: ReturnType<typeof useBrowserCardStore.getState>["cards"];
}

export function buildSnapshotState(): WorkspaceSnapshot {
  const startedAt = performance.now();
  const scrollbacks = serializeAllTerminals();
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
    version: 1,
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
            (worktreeCount, worktree) => worktreeCount + worktree.terminals.length,
            0,
          ),
        0,
      ),
    },
  });

  return snapshot;
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
