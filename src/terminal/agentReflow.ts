export interface LogicalLine {
  text: string;
  widths: number[];
}

export interface BufferSnapshot {
  lines: LogicalLine[];
  cols: number;
}

export interface ReflowResult {
  rows: string[];
}

interface SnapshotBufferSource {
  buffer: {
    active: {
      length: number;
      getLine(index: number): {
        isWrapped: boolean;
        translateToString(trimRight?: boolean): string;
        length: number;
        getCell(
          col: number,
          cell?: unknown,
        ): { getWidth(): number } | undefined;
      } | undefined;
    };
  };
}

export function snapshotBuffer(source: SnapshotBufferSource, cols: number): BufferSnapshot {
  const buf = source.buffer.active;
  const lines: LogicalLine[] = [];
  let current: LogicalLine | null = null;

  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (!line) continue;

    const text = line.translateToString(false);
    const widths: number[] = [];
    for (let c = 0; c < line.length; c++) {
      const cell = line.getCell(c);
      widths.push(cell ? cell.getWidth() : 1);
    }

    if (line.isWrapped && current) {
      current.text += text;
      current.widths.push(...widths);
    } else {
      current = { text, widths };
      lines.push(current);
    }
  }

  return { lines, cols };
}

export function reflowSnapshot(snapshot: BufferSnapshot, newCols: number): ReflowResult {
  const rows: string[] = [];

  for (const line of snapshot.lines) {
    const { text, widths } = line;
    if (newCols <= 0) {
      rows.push(text);
      continue;
    }

    let pos = 0;
    let colsUsed = 0;
    let rowStart = 0;

    while (pos < text.length) {
      const w = pos < widths.length ? widths[pos] : 1;

      if (w === 2 && colsUsed + w > newCols) {
        // Wide char doesn't fit — wrap before it
        rows.push(text.slice(rowStart, pos));
        rowStart = pos;
        colsUsed = 0;
      }

      colsUsed += w;
      pos++;

      if (colsUsed >= newCols) {
        rows.push(text.slice(rowStart, pos));
        rowStart = pos;
        colsUsed = 0;
      }
    }

    if (rowStart < text.length) {
      rows.push(text.slice(rowStart));
    } else if (pos === 0) {
      rows.push("");
    }
  }

  return { rows };
}
