import { useProjectStore } from "../stores/projectStore";
import { useSelectionStore, type SelectedItem } from "../stores/selectionStore";
import { focusTerminalInScene } from "./terminalSceneActions";

interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SceneInteractionOptions {
  bringToFront?: boolean;
}

interface WorktreeInteractionOptions extends SceneInteractionOptions {
  focus?: boolean;
}

interface TerminalInteractionOptions {
  focus?: boolean;
  focusComposer?: boolean;
  focusInput?: boolean;
}

export function setSceneSelectionRect(rect: SelectionRect | null): void {
  useSelectionStore.getState().setSelectionRect(rect);
}

export function setSceneSelection(items: SelectedItem[]): void {
  useSelectionStore.getState().setSelectedItems(items);
}

export function clearSceneSelection(): void {
  useSelectionStore.getState().clearSelection();
}

export function clearSceneFocus(): void {
  useProjectStore.getState().clearFocus();
}

export function clearSceneFocusAndSelection(): void {
  clearSceneFocus();
  clearSceneSelection();
}

export function selectCardInScene(cardId: string): void {
  useSelectionStore.getState().selectCard(cardId);
}

export function selectAnnotationInScene(annotationId: string): void {
  useSelectionStore.getState().selectAnnotation(annotationId);
}

export function activateCardInScene(cardId: string): void {
  clearSceneFocus();
  selectCardInScene(cardId);
}

export function activateAnnotationInScene(annotationId: string): void {
  clearSceneFocus();
  selectAnnotationInScene(annotationId);
}

export function selectProjectInScene(projectId: string): void {
  useSelectionStore.getState().selectProject(projectId);
}

export function selectWorktreeInScene(
  projectId: string,
  worktreeId: string,
): void {
  useSelectionStore.getState().selectWorktree(projectId, worktreeId);
}

export function selectTerminalInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): void {
  useSelectionStore
    .getState()
    .selectTerminal(projectId, worktreeId, terminalId);
}

export function focusWorktreeInScene(
  projectId: string,
  worktreeId: string,
): void {
  useProjectStore.getState().setFocusedWorktree(projectId, worktreeId);
}

export function activateProjectInScene(
  projectId: string,
  _options?: SceneInteractionOptions,
): void {
  clearSceneFocus();
  selectProjectInScene(projectId);
}

export function activateWorktreeInScene(
  projectId: string,
  worktreeId: string,
  options?: WorktreeInteractionOptions,
): void {
  if (options?.focus ?? true) {
    focusWorktreeInScene(projectId, worktreeId);
  }
  selectWorktreeInScene(projectId, worktreeId);
}

export function activateTerminalInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
  options?: TerminalInteractionOptions,
): void {
  if (options?.focus ?? true) {
    focusTerminalInScene(terminalId, {
      focusComposer: options?.focusComposer,
      focusInput: options?.focusInput,
    });
  }
  selectTerminalInScene(projectId, worktreeId, terminalId);
}
