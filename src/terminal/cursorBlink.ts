interface CursorBlinkRenderable {
  render: (...args: any[]) => void;
}

interface CursorBlinkTerminal {
  options: {
    cursorBlink: boolean;
  };
  renderer?: CursorBlinkRenderable | null;
  wasmTerm?: unknown;
  getViewportY: () => number;
}

export function syncTerminalCursorBlink(
  terminal: CursorBlinkTerminal,
  enabled: boolean,
) {
  if (terminal.options.cursorBlink === enabled) {
    return;
  }

  terminal.options.cursorBlink = enabled;

  if (terminal.renderer && terminal.wasmTerm) {
    terminal.renderer.render(
      terminal.wasmTerm,
      true,
      terminal.getViewportY(),
      terminal,
    );
  }
}
