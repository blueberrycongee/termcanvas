import { useProjectStore } from "./stores/projectStore";
import { useCanvasStore } from "./stores/canvasStore";
import { useDrawingStore } from "./stores/drawingStore";
import { useBrowserCardStore } from "./stores/browserCardStore";
import { serializeAllTerminals } from "./terminal/terminalRegistry";

export function snapshotState(): string {
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

  return JSON.stringify(
    {
      version: 1,
      viewport: useCanvasStore.getState().viewport,
      projects,
      drawings: useDrawingStore.getState().elements,
      browserCards: useBrowserCardStore.getState().cards,
    },
    null,
    2,
  );
}
