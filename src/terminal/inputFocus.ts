interface FocusTarget {
  focus: (options?: { preventScroll?: boolean }) => void;
  isConnected?: boolean;
}

interface FocusableTerminal {
  focus: (options?: { preventScroll?: boolean }) => void;
  textarea?: FocusTarget | null;
}

interface FocusContainer {
  getClientRects: () => ArrayLike<unknown>;
  contains: (node: Node | null) => boolean;
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
