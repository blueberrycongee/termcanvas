import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COMPUTER_USE_INSTRUCTIONS_URI =
  "termcanvas://computer-use/instructions";

export const COMPUTER_USE_PROTOCOL_SUMMARY =
  "AX-first desktop control protocol: observe with get_app_state before acting, prefer indexed Accessibility elements and AX actions, use screenshots to understand state, use screenshot coordinates only as a last resort, and verify with get_app_state after every action before claiming success.";

export const COMPUTER_USE_STATUS_GUIDANCE = {
  instructions_tool: "get_instructions",
  instructions_resource: COMPUTER_USE_INSTRUCTIONS_URI,
  protocol: [
    "Use status, list_apps, open_app, then get_app_state before interacting with a local Mac app.",
    "Prefer AX element indexes from get_app_state for click, set_value, scroll, drag, and perform_secondary_action.",
    "Use keyboard input when AX exposes focusable fields but not direct actions.",
    "Use screenshot coordinates only when AX does not expose the target; set coordinate_space to screenshot for coordinates read from screenshots.",
    "After every action, call get_app_state again and verify the observed UI before reporting success.",
  ],
};

const FALLBACK_INSTRUCTIONS = `# TermCanvas Computer Use

Use this MCP server for local Mac desktop automation. Follow the AX-first protocol:

1. Call status, list_apps, open_app, then get_app_state before acting.
2. Prefer indexed Accessibility elements from get_app_state.
3. Use screenshots for observation and use screenshot coordinates only as the last resort.
4. After every action, call get_app_state again and verify the result before reporting success.
`;

function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function existingInstructionCandidates(): string[] {
  const configured = process.env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS?.trim();
  const dir = moduleDir();
  return [
    configured ?? "",
    path.resolve(dir, "..", "skills", "computer-use-instructions.md"),
    path.resolve(dir, "..", "..", "skills", "computer-use-instructions.md"),
    path.resolve(dir, "..", "..", "..", "skills", "computer-use-instructions.md"),
  ].filter(Boolean);
}

export function readComputerUseInstructions(): string {
  const seen = new Set<string>();
  for (const candidate of existingInstructionCandidates()) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      const stats = fs.statSync(resolved);
      if (!stats.isFile()) continue;
      return `${fs.readFileSync(resolved, "utf8").trimEnd()}\n`;
    } catch {
      // Keep looking; packaged and dev layouts put the file in different places.
    }
  }
  return FALLBACK_INSTRUCTIONS;
}
