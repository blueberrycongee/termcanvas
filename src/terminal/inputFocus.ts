interface FocusTarget {
  focus: (options?: { preventScroll?: boolean }) => void;
  isConnected?: boolean;
  style?: Partial<CSSStyleDeclaration>;
}

interface FocusCanvas {
  getBoundingClientRect: () => DOMRect | Pick<DOMRect, "left" | "top" | "width" | "height">;
  clientWidth?: number;
  clientHeight?: number;
}

interface FocusRenderer {
  getCanvas?: () => FocusCanvas;
}

interface FocusCursor {
  x: number;
  y: number;
}

interface FocusWasmTerminal {
  getCursor?: () => FocusCursor;
}

interface FocusableTerminal {
  focus: (options?: { preventScroll?: boolean }) => void;
  textarea?: FocusTarget | null;
  renderer?: FocusRenderer | null;
  wasmTerm?: FocusWasmTerminal | null;
  cols?: number;
  rows?: number;
}

interface FocusContainer {
  getClientRects: () => ArrayLike<unknown>;
  contains: (node: Node | null) => boolean;
}

function syncTextareaToCursor(terminal: FocusableTerminal, textarea: FocusTarget) {
  if (!textarea.style) {
    return;
  }

  const canvas = terminal.renderer?.getCanvas?.();
  const cursor = terminal.wasmTerm?.getCursor?.();
  const cols = terminal.cols ?? 0;
  const rows = terminal.rows ?? 0;
  if (!canvas || !cursor || cols <= 0 || rows <= 0) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const localWidth = canvas.clientWidth ?? rect.width;
  const localHeight = canvas.clientHeight ?? rect.height;
  if (localWidth <= 0 || localHeight <= 0) {
    return;
  }

  const cellWidth = localWidth / cols;
  const cellHeight = localHeight / rows;
  const cursorX = Math.max(0, Math.min(cols - 1, cursor.x));
  const cursorY = Math.max(0, Math.min(rows - 1, cursor.y));

  textarea.style.position = "absolute";
  textarea.style.left = `${cursorX * cellWidth}px`;
  textarea.style.top = `${cursorY * cellHeight}px`;
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.caretColor = "transparent";
  textarea.style.color = "transparent";
}

export function focusTerminalInputElement(
  terminal: FocusableTerminal | null,
  tile: FocusContainer | null,
  getActiveElement: () => Element | null = () =>
    typeof document !== "undefined" ? document.activeElement : null,
): boolean {
  if (!terminal || !tile || tile.getClientRects().length === 0) {
    return false;
  }

  const textarea = terminal.textarea;
  if (textarea && textarea.isConnected !== false) {
    syncTextareaToCursor(terminal, textarea);
    textarea.focus({ preventScroll: true });
    const activeAfterTextareaFocus = getActiveElement();
    if (
      activeAfterTextareaFocus === (textarea as unknown as Element) ||
      tile.contains(activeAfterTextareaFocus)
    ) {
      return true;
    }
  }

  terminal.focus({ preventScroll: true });
  return tile.contains(getActiveElement());
}
