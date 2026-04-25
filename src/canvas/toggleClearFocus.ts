import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useViewportFocusStore } from "../stores/viewportFocusStore";
import { getTerminalFocusOrder } from "../stores/projectFocus";
import { activateTerminalInScene } from "../actions/sceneSelectionActions";
import { panToTerminal } from "../utils/panToTerminal";
import {
  getCanvasRightInset,
  getCanvasLeftInset,
} from "./viewportBounds";

function getAllTerminals() {
  const { projects } = useProjectStore.getState();
  return getTerminalFocusOrder(projects);
}

function getFocusedTerminalIndex(
  list: ReturnType<typeof getAllTerminals>,
) {
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
  const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const viewW = window.innerWidth - leftOffset - rightOffset - padding * 2;
  const viewH = window.innerHeight - toolbarH - padding * 2;
  const scale = Math.min(1, viewW / contentW, viewH / contentH);
  useViewportFocusStore.getState().setFitAllScale(scale);
  const x = -minX * scale + padding;
  const y = -minY * scale + padding + toolbarH;
  useCanvasStore.getState().animateTo(x, y, scale);
}

export function toggleClearFocus(): void {
  const list = getAllTerminals();
  const focusedIdx = getFocusedTerminalIndex(list);
  const store = useViewportFocusStore.getState();

  if (focusedIdx !== -1) {
    const focused = list[focusedIdx];
    store.setLastFocusedTerminalId(focused.terminalId);
    if (store.zoomedOutTerminalId === focused.terminalId) {
      panToTerminal(focused.terminalId);
      store.setZoomedOutTerminalId(null);
    } else {
      zoomToFitAll();
      store.setZoomedOutTerminalId(focused.terminalId);
    }
  } else if (store.lastFocusedTerminalId) {
    const restored = list.find(
      (item) => item.terminalId === store.lastFocusedTerminalId,
    );
    if (restored) {
      activateTerminalInScene(
        restored.projectId,
        restored.worktreeId,
        restored.terminalId,
      );
      panToTerminal(restored.terminalId);
      store.setZoomedOutTerminalId(null);
    } else {
      store.setLastFocusedTerminalId(null);
      store.setZoomedOutTerminalId(null);
    }
  } else if (list.length > 0) {
    const first = list[0];
    store.setLastFocusedTerminalId(first.terminalId);
    activateTerminalInScene(
      first.projectId,
      first.worktreeId,
      first.terminalId,
    );
    panToTerminal(first.terminalId);
    store.setZoomedOutTerminalId(null);
  }
}
