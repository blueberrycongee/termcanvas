interface PseudoTerminalView {
  cols: number;
  rows: number;
}

interface PseudoTerminalSession {
  fit: () => void;
}

export interface PtyCreateSize {
  cols: number;
  rows: number;
}

export function getInitialPtyCreateSize(
  session: PseudoTerminalSession | null,
  terminal: PseudoTerminalView | null,
): PtyCreateSize | null {
  if (!session || !terminal) {
    return null;
  }

  session.fit();

  const { cols, rows } = terminal;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
    return null;
  }
  if (cols < 1 || rows < 1) {
    return null;
  }

  return { cols, rows };
}
