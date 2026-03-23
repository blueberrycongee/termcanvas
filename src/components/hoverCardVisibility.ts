export interface HoverCardVisibilityState {
  pinned: boolean;
  hovered: boolean;
  dragging: boolean;
}

export function createHoverCardVisibilityState({
  pinned,
  hovered,
  draggingSelf,
  draggingRelated = false,
}: {
  pinned: boolean;
  hovered: boolean;
  draggingSelf: boolean;
  draggingRelated?: boolean;
}): HoverCardVisibilityState {
  return {
    pinned,
    hovered,
    dragging: draggingSelf || draggingRelated,
  };
}

export function shouldKeepHoverCardVisible(
  state: HoverCardVisibilityState,
): boolean {
  return state.pinned || state.hovered || state.dragging;
}

export function clearHoverCardHideTimeout(timeoutRef: {
  current: ReturnType<typeof setTimeout> | null;
}): void {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
}

export function scheduleHoverCardHide(
  timeoutRef: { current: ReturnType<typeof setTimeout> | null },
  getState: () => HoverCardVisibilityState,
  hide: () => void,
  delayMs = 300,
): void {
  clearHoverCardHideTimeout(timeoutRef);
  timeoutRef.current = setTimeout(() => {
    timeoutRef.current = null;
    if (!shouldKeepHoverCardVisible(getState())) {
      hide();
    }
  }, delayMs);
}
