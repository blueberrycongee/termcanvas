import {
  getWorktreeSize,
  packTerminals,
  type PackedTerminal,
  type TileDims,
} from "../layout";
import type { BrowserCardData } from "../stores/browserCardStore";
import type { DrawingElement } from "../stores/drawingStore";
import type { SelectedItem } from "../stores/selectionStore";
import type { ProjectData, TerminalData, WorktreeData } from "../types";

export interface RenderableTerminalLayout {
  item: PackedTerminal;
  terminal: TerminalData;
}

export interface SceneSelectionEntities {
  annotations?: DrawingElement[];
  browserCards?: Record<string, BrowserCardData>;
  cards?: Record<string, BrowserCardData>;
  projects: ProjectData[];
}

export function getRenderableTerminals(worktree: WorktreeData): TerminalData[] {
  return worktree.terminals.filter((terminal) => !terminal.stashed);
}

export function getRenderableTerminalSpans(worktree: WorktreeData) {
  return getRenderableTerminals(worktree).map((terminal) => terminal.span);
}

export function getRenderableTerminalLayouts(
  worktree: WorktreeData,
  gridCols?: number,
  tileDims?: TileDims,
): RenderableTerminalLayout[] {
  const terminals = getRenderableTerminals(worktree);
  const packed = packTerminals(
    terminals.map((terminal) => terminal.span),
    gridCols,
    tileDims,
  );

  return terminals.flatMap((terminal, index) => {
    const item = packed[index];
    if (!item) {
      return [];
    }

    return [{ item, terminal }];
  });
}

export function getRenderableWorktreeSize(
  worktree: WorktreeData,
  gridCols?: number,
  tileDims?: TileDims,
) {
  return getWorktreeSize(
    getRenderableTerminalSpans(worktree),
    worktree.collapsed,
    gridCols,
    tileDims,
  );
}

export function getStashedTerminalIds(projects: ProjectData[]): Set<string> {
  const ids = new Set<string>();

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.stashed) {
          ids.add(terminal.id);
        }
      }
    }
  }

  return ids;
}

export function filterValidSelectedItems(
  selectedItems: SelectedItem[],
  entities: SceneSelectionEntities,
): SelectedItem[] {
  const projectIds = new Set<string>();
  const worktreeKeys = new Set<string>();
  const terminalKeys = new Set<string>();

  for (const project of entities.projects) {
    projectIds.add(project.id);
    for (const worktree of project.worktrees) {
      worktreeKeys.add(`${project.id}:${worktree.id}`);
      for (const terminal of worktree.terminals) {
        if (terminal.stashed) {
          continue;
        }

        terminalKeys.add(`${project.id}:${worktree.id}:${terminal.id}`);
      }
    }
  }

  const cardIds = new Set<string>();
  for (const cardId of Object.keys(entities.cards ?? {})) {
    cardIds.add(`browser:${cardId}`);
  }
  for (const cardId of Object.keys(entities.browserCards ?? {})) {
    cardIds.add(`browser:${cardId}`);
  }
  const annotationIds = entities.annotations
    ? new Set(entities.annotations.map((annotation) => annotation.id))
    : null;

  return selectedItems.filter((item) => {
    switch (item.type) {
      case "project":
        return projectIds.has(item.projectId);
      case "worktree":
        return worktreeKeys.has(`${item.projectId}:${item.worktreeId}`);
      case "terminal":
        return terminalKeys.has(
          `${item.projectId}:${item.worktreeId}:${item.terminalId}`,
        );
      case "card":
        return cardIds.size > 0 ? cardIds.has(item.cardId) : true;
      case "annotation":
        return annotationIds ? annotationIds.has(item.annotationId) : true;
    }
  });
}

export function sameSelectedItems(
  left: SelectedItem[],
  right: SelectedItem[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => {
    const other = right[index];
    if (!other || item.type !== other.type) {
      return false;
    }

    switch (item.type) {
      case "project":
        return other.type === "project" && item.projectId === other.projectId;
      case "worktree":
        return (
          other.type === "worktree" &&
          item.projectId === other.projectId &&
          item.worktreeId === other.worktreeId
        );
      case "terminal":
        return (
          other.type === "terminal" &&
          item.projectId === other.projectId &&
          item.worktreeId === other.worktreeId &&
          item.terminalId === other.terminalId
        );
      case "card":
        return other.type === "card" && item.cardId === other.cardId;
      case "annotation":
        return (
          other.type === "annotation" &&
          item.annotationId === other.annotationId
        );
    }
  });
}
