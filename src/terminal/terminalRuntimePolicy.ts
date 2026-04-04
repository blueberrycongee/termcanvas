export type TerminalMountMode = "live" | "preview" | "unmounted";

const ANSI_ESCAPE_PATTERN =
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const MAX_PREVIEW_ANSI_CHARS = 200_000;
const MAX_PREVIEW_TEXT_CHARS = 8_000;

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

  return serialized.slice(serialized.length - MAX_PREVIEW_ANSI_CHARS);
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
