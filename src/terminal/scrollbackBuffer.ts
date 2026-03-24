interface ScrollbackLine {
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

interface ScrollbackBuffer {
  readonly length: number;
  getLine(y: number): ScrollbackLine | undefined;
}

interface ScrollbackBufferNamespace {
  readonly active: ScrollbackBuffer;
  readonly normal: ScrollbackBuffer;
  readonly alternate: ScrollbackBuffer;
}

/**
 * Snapshot persistence should prefer the normal buffer when an alternate
 * screen app is active. Restoring a stale full-screen TUI as plain text is
 * less useful than restoring the user's actual scrollback history.
 */
export function getSerializableBuffer(
  buffers: ScrollbackBufferNamespace,
): ScrollbackBuffer {
  const alternateIsActive = buffers.active === buffers.alternate;
  if (alternateIsActive && buffers.normal.length > 0) {
    return buffers.normal;
  }

  return buffers.active;
}
