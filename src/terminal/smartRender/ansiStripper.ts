// Reuses the same pattern from terminalRuntimePolicy.ts
const ANSI_ESCAPE_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips ANSI control codes
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_PATTERN, "");
}
