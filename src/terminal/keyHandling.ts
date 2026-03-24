export const KILL_LINE_SEQUENCE = "\x15";

/**
 * ghostty-web custom key handlers return true to prevent default terminal
 * handling. We only intercept Command+Backspace and let every other key flow
 * through to the terminal normally.
 */
export function handleTerminalCustomKeyEvent(
  event: Pick<KeyboardEvent, "type" | "metaKey" | "key">,
  writeData: (data: string) => void,
): boolean {
  if (event.type === "keydown" && event.metaKey && event.key === "Backspace") {
    writeData(KILL_LINE_SEQUENCE);
    return true;
  }

  return false;
}
