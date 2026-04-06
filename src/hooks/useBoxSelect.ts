import { useCallback } from "react";
import {
  activateCardInScene,
  activateAnnotationInScene,
  activateTerminalInScene,
  activateWorktreeInScene,
  setSceneSelection,
  setSceneSelectionRect,
} from "../actions/sceneSelectionActions";
import {
  getDrawingElementBounds,
  resolveDrawingElementForRender,
} from "../canvas/annotationGeometry";
import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore, getProjectBounds } from "../stores/projectStore";
import { useCardLayoutStore, resolveAllCardPositions } from "../stores/cardLayoutStore";
import {
  getRenderableTerminalLayouts,
  getRenderableWorktreeSize,
} from "../canvas/sceneState";
import { useDrawingStore } from "../stores/drawingStore";
import { type SelectedItem } from "../stores/selectionStore";
import { screenPointToCanvasPoint } from "../canvas/viewportBounds";
import {
  WT_PAD,
  WT_TITLE_H,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";

const BOX_SELECT_BLOCK_SELECTOR = "[data-scene-box-select-block]";

function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function shouldIgnoreBoxSelectTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined") {
    return false;
  }
  return target instanceof Element && !!target.closest(BOX_SELECT_BLOCK_SELECTOR);
}

export function prioritizeBoxSelectionItems(items: SelectedItem[]): SelectedItem[] {
  const annotationItems = items.filter((item) => item.type === "annotation");
  if (annotationItems.length > 0) {
    return annotationItems;
  }

  const cardItems = items.filter((item) => item.type === "card");
  if (cardItems.length > 0) {
    return cardItems;
  }

  return items;
}

function screenToCanvas(clientX: number, clientY: number) {
  const { viewport, leftPanelCollapsed, leftPanelWidth } =
    useCanvasStore.getState();
  return screenPointToCanvasPoint(
    clientX,
    clientY,
    viewport,
    leftPanelCollapsed,
    leftPanelWidth,
  );
}

function getItemsInRect(rect: { x: number; y: number; w: number; h: number }): SelectedItem[] {
  const nr = {
    x: rect.w < 0 ? rect.x + rect.w : rect.x,
    y: rect.h < 0 ? rect.y + rect.h : rect.y,
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };

  const items: SelectedItem[] = [];
  const { projects } = useProjectStore.getState();

  const selectedProjectIds = new Set<string>();
  for (const p of projects) {
    const bounds = getProjectBounds(p);
    if (rectsIntersect(nr, bounds)) {
      items.push({ type: "project", projectId: p.id });
      selectedProjectIds.add(p.id);
    }
  }

  // Skip worktrees whose parent project is already selected (avoid duplicates)
  const selectedWorktreeKeys = new Set<string>();
  for (const p of projects) {
    if (selectedProjectIds.has(p.id)) continue;
    for (const wt of p.worktrees) {
      const wtSize = getRenderableWorktreeSize(wt);
      const wtAbsX = p.position.x + PROJ_PAD + wt.position.x;
      const wtAbsY = p.position.y + PROJ_TITLE_H + PROJ_PAD + wt.position.y;
      if (rectsIntersect(nr, { x: wtAbsX, y: wtAbsY, w: wtSize.w, h: wtSize.h })) {
        items.push({ type: "worktree", projectId: p.id, worktreeId: wt.id });
        selectedWorktreeKeys.add(`${p.id}:${wt.id}`);
      }
    }
  }

  for (const p of projects) {
    if (selectedProjectIds.has(p.id)) continue;
    for (const wt of p.worktrees) {
      if (selectedWorktreeKeys.has(`${p.id}:${wt.id}`)) continue;
      if (wt.collapsed) continue;
      const wtAbsX = p.position.x + PROJ_PAD + wt.position.x + WT_PAD;
      const wtAbsY = p.position.y + PROJ_TITLE_H + PROJ_PAD + wt.position.y + WT_TITLE_H + WT_PAD;
      for (const { item, terminal } of getRenderableTerminalLayouts(wt)) {
        const termRect = {
          x: wtAbsX + item.x,
          y: wtAbsY + item.y,
          w: item.w,
          h: item.h,
        };
        if (rectsIntersect(nr, termRect)) {
          items.push({
            type: "terminal",
            projectId: p.id,
            worktreeId: wt.id,
            terminalId: terminal.id,
          });
        }
      }
    }
  }

  const cards = useCardLayoutStore.getState().cards;
  const projectBounds = projects.map((p) => getProjectBounds(p));
  const resolved = resolveAllCardPositions(cards, projectBounds);
  for (const [cardId, entry] of Object.entries(cards)) {
    const pos = resolved[cardId];
    if (!pos) continue;
    if (rectsIntersect(nr, { x: pos.x, y: pos.y, w: entry.w, h: entry.h })) {
      items.push({ type: "card", cardId });
    }
  }

  for (const element of useDrawingStore.getState().elements) {
    const renderedElement = resolveDrawingElementForRender(element, projects);
    if (rectsIntersect(nr, getDrawingElementBounds(renderedElement))) {
      items.push({ type: "annotation", annotationId: element.id });
    }
  }

  return prioritizeBoxSelectionItems(items);
}

export function activateSingleBoxSelectionItem(item: SelectedItem): void {
  if (item.type === "terminal") {
    activateTerminalInScene(
      item.projectId,
      item.worktreeId,
      item.terminalId,
      { focusComposer: false },
    );
  } else if (item.type === "worktree") {
    activateWorktreeInScene(item.projectId, item.worktreeId);
  } else if (item.type === "card") {
    activateCardInScene(item.cardId);
  } else if (item.type === "annotation") {
    activateAnnotationInScene(item.annotationId);
  }
}

export function useBoxSelect() {
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || !e.shiftKey) return;
    if (shouldIgnoreBoxSelectTarget(e.target)) return;

    // Don't activate in drawing mode
    if (useDrawingStore.getState().tool !== "select") return;

    e.preventDefault();
    e.stopPropagation();

    const start = screenToCanvas(e.clientX, e.clientY);
    setSceneSelectionRect({ x: start.x, y: start.y, w: 0, h: 0 });

    const handleMove = (ev: MouseEvent) => {
      const current = screenToCanvas(ev.clientX, ev.clientY);
      setSceneSelectionRect({
        x: start.x,
        y: start.y,
        w: current.x - start.x,
        h: current.y - start.y,
      });
    };

    const handleUp = (ev: MouseEvent) => {
      const end = screenToCanvas(ev.clientX, ev.clientY);
      const rect = {
        x: start.x,
        y: start.y,
        w: end.x - start.x,
        h: end.y - start.y,
      };

      const items = getItemsInRect(rect);
      setSceneSelection(items);
      if (items.length === 1) {
        activateSingleBoxSelectionItem(items[0]);
      }
      setSceneSelectionRect(null);

      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, []);

  return { handleMouseDown };
}
