export interface PendingFocusFrame {
  current: number | null;
}

export function scheduleTerminalFocus(
  focus: () => void,
  pending: PendingFocusFrame,
  requestFrame: typeof requestAnimationFrame = requestAnimationFrame,
  cancelFrame: typeof cancelAnimationFrame = cancelAnimationFrame,
) {
  if (pending.current !== null) {
    cancelFrame(pending.current);
  }

  pending.current = requestFrame(() => {
    pending.current = null;
    focus();
  });
}

export function cancelScheduledTerminalFocus(
  pending: PendingFocusFrame,
  cancelFrame: typeof cancelAnimationFrame = cancelAnimationFrame,
) {
  if (pending.current === null) {
    return;
  }

  cancelFrame(pending.current);
  pending.current = null;
}
