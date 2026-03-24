interface SnapshotCell {
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

interface SnapshotLine extends SnapshotCell {
  readonly isWrapped: boolean;
}

interface SnapshotBuffer {
  readonly length: number;
  getLine(y: number): SnapshotLine | undefined;
}

export function serializeBufferToText(buffer: SnapshotBuffer): string {
  const lines: string[] = [];
  let current = "";

  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;

    current += line.translateToString(true);
    if (!line.isWrapped) {
      lines.push(current);
      current = "";
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\r\n");
}
