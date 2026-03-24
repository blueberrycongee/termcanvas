interface FocusTarget {
  focus: () => void;
  isConnected?: boolean;
}

interface FocusableTerminal {
  focus: () => void;
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
    textarea.focus();
    const activeAfterTextareaFocus = getActiveElement();
    if (
      activeAfterTextareaFocus === (textarea as unknown as Element) ||
      tile.contains(activeAfterTextareaFocus)
    ) {
      return true;
    }
  }

  terminal.focus();
  return tile.contains(getActiveElement());
}
