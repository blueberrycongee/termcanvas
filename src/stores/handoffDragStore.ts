import { create } from "zustand";
import { activateTerminalInScene } from "../actions/sceneSelectionActions";
import { findTerminalById, useProjectStore } from "./projectStore";
import { useComposerStore } from "./composerStore";
import { getTerminalPtyId } from "../terminal/terminalRuntimeStore";

export interface HandoffPayload {
  text: string;
  sourceTerminalId: string;
  sourceTitle: string;
}

interface HandoffDragStore {
  active: boolean;
  payload: HandoffPayload | null;
  pointer: { x: number; y: number };
  hoveredTerminalId: string | null;
  hoveredComposer: boolean;
  begin: (
    payload: HandoffPayload,
    pointer: { x: number; y: number },
  ) => void;
  setPointer: (x: number, y: number) => void;
  setHoveredTerminal: (id: string | null) => void;
  setHoveredComposer: (hovered: boolean) => void;
  end: () => void;
}

export const useHandoffDragStore = create<HandoffDragStore>((set) => ({
  active: false,
  payload: null,
  pointer: { x: 0, y: 0 },
  hoveredTerminalId: null,
  hoveredComposer: false,
  begin: (payload, pointer) =>
    set({
      active: true,
      payload,
      pointer,
      hoveredTerminalId: null,
      hoveredComposer: false,
    }),
  setPointer: (x, y) => set({ pointer: { x, y } }),
  setHoveredTerminal: (hoveredTerminalId) => set({ hoveredTerminalId }),
  setHoveredComposer: (hoveredComposer) => set({ hoveredComposer }),
  end: () =>
    set({
      active: false,
      payload: null,
      hoveredTerminalId: null,
      hoveredComposer: false,
    }),
}));

// Custom MIME used to advertise the handoff payload kind to drop targets that
// inspect dataTransfer (none today, but reserved). Kept as a string constant
// so future components have a single source of truth.
export const HANDOFF_MIME = "text/x-tc-handoff";

interface DropResolution {
  kind: "terminal" | "composer" | "none";
  terminalId?: string;
}

function findDropTarget(
  clientX: number,
  clientY: number,
  sourceTerminalId: string,
): DropResolution {
  let el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  while (el) {
    if (el.dataset?.handoffComposer === "true") {
      return { kind: "composer" };
    }
    const targetId = el.dataset?.handoffTerminalId;
    if (targetId) {
      if (targetId === sourceTerminalId) {
        return { kind: "none" };
      }
      return { kind: "terminal", terminalId: targetId };
    }
    el = el.parentElement;
  }
  return { kind: "none" };
}

function deliverToTerminal(terminalId: string, text: string) {
  const ptyId = getTerminalPtyId(terminalId);
  if (ptyId === null) return;
  // Match the source's line endings — never silently append a newline.
  // The composer/PTY-write path elsewhere does the same.
  window.termcanvas.terminal.input(ptyId, text);

  const projects = useProjectStore.getState().projects;
  const found = findTerminalById(projects, terminalId);
  if (found) {
    activateTerminalInScene(found.projectId, found.worktreeId, terminalId);
  }
}

function deliverToComposer(text: string) {
  // "Fill" the composer per the task brief: replace draft. The user can edit
  // before sending. Then move focus into the composer so the next keystroke
  // lands in the input, not the canvas.
  useComposerStore.getState().setDraft(text);
  window.dispatchEvent(new CustomEvent("termcanvas:focus-composer"));
}

const DRAG_THRESHOLD_PX = 4;

export function startHandoffDrag(
  payload: HandoffPayload,
  initialPointer: { x: number; y: number },
) {
  const store = useHandoffDragStore.getState();
  store.begin(payload, initialPointer);

  let armed = false;

  const updateHovered = (clientX: number, clientY: number) => {
    const target = findDropTarget(clientX, clientY, payload.sourceTerminalId);
    const next = useHandoffDragStore.getState();
    if (target.kind === "terminal") {
      if (next.hoveredTerminalId !== target.terminalId) {
        next.setHoveredTerminal(target.terminalId ?? null);
      }
      if (next.hoveredComposer) next.setHoveredComposer(false);
    } else if (target.kind === "composer") {
      if (next.hoveredTerminalId !== null) next.setHoveredTerminal(null);
      if (!next.hoveredComposer) next.setHoveredComposer(true);
    } else {
      if (next.hoveredTerminalId !== null) next.setHoveredTerminal(null);
      if (next.hoveredComposer) next.setHoveredComposer(false);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!armed) {
      const dx = e.clientX - initialPointer.x;
      const dy = e.clientY - initialPointer.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      armed = true;
    }
    useHandoffDragStore.getState().setPointer(e.clientX, e.clientY);
    updateHovered(e.clientX, e.clientY);
  };

  const onPointerUp = (e: PointerEvent) => {
    cleanup();
    if (!armed) return;
    const target = findDropTarget(e.clientX, e.clientY, payload.sourceTerminalId);
    if (target.kind === "terminal" && target.terminalId) {
      deliverToTerminal(target.terminalId, payload.text);
    } else if (target.kind === "composer") {
      deliverToComposer(payload.text);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
    }
  };

  // A native dragstart from anywhere else on the page (browser-initiated) would
  // race with our synthetic drag. Cancel ours so the browser owns the gesture.
  const onNativeDragStart = () => cleanup();

  // While a synthetic drag is in flight, the user's mouse button is still
  // pressed, so the underlying xterm would otherwise interpret each move as
  // selection extension and the eventual release as a click that clears the
  // selection. Swallow the compat mouse events at capture so they never reach
  // xterm. Pointer events are unaffected, so our own tracking still works.
  const swallowMouse = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  function cleanup() {
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("dragstart", onNativeDragStart, true);
    document.removeEventListener("mousedown", swallowMouse, true);
    document.removeEventListener("mousemove", swallowMouse, true);
    document.removeEventListener("mouseup", swallowMouse, true);
    document.removeEventListener("click", swallowMouse, true);
    useHandoffDragStore.getState().end();
  }

  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerUp, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("dragstart", onNativeDragStart, true);
  document.addEventListener("mousedown", swallowMouse, true);
  document.addEventListener("mousemove", swallowMouse, true);
  document.addEventListener("mouseup", swallowMouse, true);
  document.addEventListener("click", swallowMouse, true);
}
