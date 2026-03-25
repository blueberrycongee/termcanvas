import type { TerminalBackend } from "../types/index.ts";

interface TerminalBackendPreferenceShape {
  terminalBackend?: unknown;
  terminalRenderer?: unknown;
}

export function resolveTerminalBackendPreference(
  input: unknown,
): TerminalBackend {
  if (!input || typeof input !== "object") {
    return "ghostty";
  }

  const parsed = input as TerminalBackendPreferenceShape;

  if (
    parsed.terminalBackend === "ghostty" ||
    parsed.terminalBackend === "xterm"
  ) {
    return parsed.terminalBackend;
  }

  if (parsed.terminalRenderer === "xterm") {
    return "xterm";
  }

  return "ghostty";
}
