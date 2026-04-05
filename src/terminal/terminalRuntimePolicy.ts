export type TerminalMountMode = "live" | "preview" | "unmounted";

const ANSI_ESCAPE_PATTERN =
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const MAX_PREVIEW_ANSI_CHARS = 200_000;
const MAX_PREVIEW_TEXT_CHARS = 8_000;
const ANSI_BOUNDARY_SCAN_CHARS = 64;

export function resolveTerminalMountMode({
  focused,
  visible,
}: {
  focused: boolean;
  visible: boolean;
}): TerminalMountMode {
  if (focused || visible) {
    return "live";
  }

  return "unmounted";
}

export function clampPreviewAnsi(serialized: string): string {
  if (serialized.length <= MAX_PREVIEW_ANSI_CHARS) {
    return serialized;
  }

  const requestedStart = serialized.length - MAX_PREVIEW_ANSI_CHARS;
  const start = resolvePreviewStart(serialized, requestedStart);
  return serialized.slice(start);
}

export function toPreviewText(serialized: string): string {
  const stripped = serialized
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\r/g, "")
    .trimEnd();

  if (stripped.length <= MAX_PREVIEW_TEXT_CHARS) {
    return stripped;
  }

  return stripped.slice(stripped.length - MAX_PREVIEW_TEXT_CHARS);
}

function resolvePreviewStart(serialized: string, requestedStart: number): number {
  const scanStart = Math.max(0, requestedStart - ANSI_BOUNDARY_SCAN_CHARS);
  const scanEnd = Math.min(serialized.length, requestedStart + ANSI_BOUNDARY_SCAN_CHARS);
  const boundarySlice = serialized.slice(scanStart, scanEnd);
  const pattern = new RegExp(ANSI_ESCAPE_PATTERN.source, "g");

  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(boundarySlice)) !== null) {
    const matchStart = scanStart + match.index;
    const matchEnd = matchStart + match[0].length;
    if (matchStart < requestedStart && matchEnd > requestedStart) {
      return matchEnd;
    }
  }

  return requestedStart;
}
