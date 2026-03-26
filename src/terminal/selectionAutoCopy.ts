export interface TerminalSelectionAutoCopyState {
  selectionRevision: number;
  lastCopiedSelectionRevision: number;
  activePointerGestureRevision: number | null;
  nextPointerGestureRevision: number;
  selectionPointerGestureRevision: number | null;
}

export function createTerminalSelectionAutoCopyState(): TerminalSelectionAutoCopyState {
  return {
    selectionRevision: 0,
    lastCopiedSelectionRevision: 0,
    activePointerGestureRevision: null,
    nextPointerGestureRevision: 1,
    selectionPointerGestureRevision: null,
  };
}

export function markTerminalSelectionPointerStarted(
  state: TerminalSelectionAutoCopyState,
): TerminalSelectionAutoCopyState {
  return {
    ...state,
    activePointerGestureRevision: state.nextPointerGestureRevision,
    nextPointerGestureRevision: state.nextPointerGestureRevision + 1,
  };
}

export function markTerminalSelectionPointerEnded(
  state: TerminalSelectionAutoCopyState,
): TerminalSelectionAutoCopyState {
  return {
    ...state,
    activePointerGestureRevision: null,
  };
}

export function markTerminalSelectionChanged(
  state: TerminalSelectionAutoCopyState,
): TerminalSelectionAutoCopyState {
  return {
    ...state,
    selectionRevision: state.selectionRevision + 1,
    selectionPointerGestureRevision: state.activePointerGestureRevision,
  };
}

export function markTerminalSelectionCopied(
  state: TerminalSelectionAutoCopyState,
): TerminalSelectionAutoCopyState {
  return {
    ...state,
    lastCopiedSelectionRevision: state.selectionRevision,
  };
}

export function shouldAutoCopyTerminalSelection(
  state: TerminalSelectionAutoCopyState,
  selectionText: string,
  trigger: "selectionchange" | "mouseup",
): boolean {
  if (trigger !== "mouseup") {
    return false;
  }

  return (
    selectionText.length > 0 &&
    state.selectionRevision > state.lastCopiedSelectionRevision &&
    state.selectionPointerGestureRevision !== null
  );
}
