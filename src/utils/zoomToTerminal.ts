import { useProjectStore } from "../stores/projectStore.ts";
import { useCanvasStore } from "../stores/canvasStore.ts";
import {
  packTerminals,
  WT_PAD,
  WT_TITLE_H,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout.ts";
import {
  getCenteredViewportTarget,
  getViewportFitScale,
} from "./canvasViewport.ts";

interface ZoomToTerminalOptions {
  focus?: boolean;
}

export function zoomToTerminal(
  projectId: string,
  worktreeId: string,
  terminalId: string,
  options: ZoomToTerminalOptions = {},
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

  if (options.focus) {
    useProjectStore.getState().setFocusedTerminal(terminalId);
  }

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
  const scale =
    getViewportFitScale(item.w, item.h, {
      rightPanelCollapsed,
      padding: 60,
    }) * 0.85;
  const target = getCenteredViewportTarget(absX, absY, item.w, item.h, {
    rightPanelCollapsed,
    scale,
  });

  useCanvasStore.getState().animateTo(target.x, target.y, scale);
}
