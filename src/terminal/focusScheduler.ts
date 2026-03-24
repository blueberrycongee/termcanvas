export interface PendingFocusFrame {
  current: number | null;
}

export function scheduleTerminalFocus(
  focus: () => boolean | void,
  pending: PendingFocusFrame,
  requestFrame: typeof requestAnimationFrame = requestAnimationFrame,
  cancelFrame: typeof cancelAnimationFrame = cancelAnimationFrame,
  maxAttempts = 24,
) {
  if (pending.current !== null) {
    cancelFrame(pending.current);
  }

  const run = () => {
    pending.current = null;
    const focused = focus();
    if (focused === false && maxAttempts > 1) {
      scheduleTerminalFocus(
        focus,
        pending,
        requestFrame,
        cancelFrame,
        maxAttempts - 1,
      );
    }
  };

  pending.current = requestFrame(run);
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
