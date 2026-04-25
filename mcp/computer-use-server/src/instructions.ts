import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COMPUTER_USE_INSTRUCTIONS_URI =
  "termcanvas://computer-use/instructions";

export const COMPUTER_USE_PROTOCOL_SUMMARY =
  "TermCanvas desktop control protocol: use these tools for local macOS apps and system UI, not browser/Playwright tools; observe with get_app_state before acting, prefer Accessibility elements and AX actions, use the returned screenshot only as fallback evidence, and verify with get_app_state after every action before claiming success.";

export const COMPUTER_USE_STATUS_GUIDANCE = {
  setup_tool: "setup",
  instructions_tool: "get_instructions",
  instructions_resource: COMPUTER_USE_INSTRUCTIONS_URI,
  protocol: [
    "Use status first. If the helper is not healthy or permissions are missing, call setup.",
    "If permissions remain false after the user says they already allowed them, guide the user to remove stale TermCanvas and computer-use-helper entries from both macOS permission panes, then add /Applications/TermCanvas.app and /Applications/TermCanvas.app/Contents/Resources/computer-use-helper again.",
    "For local macOS desktop apps, use TermCanvas Computer Use. Do not use browser automation or Playwright unless the target is a web page in a browser.",
    "Use list_apps for app identity and list_windows for window identity. Prefer pid + window_id for window-scoped observation when available.",
    "Before every desktop interaction, call get_window_state for the target pid/window_id when available, otherwise get_app_state, and treat its AX tree plus returned window screenshot as the current source of truth.",
    "If get_app_state is empty or sparse, re-activate/open the app, retry with bundle_id or pid, increase max_depth if needed, and observe again before declaring the app inaccessible.",
    "Prefer AX element indexes for perform_secondary_action, set_value, click, scroll, and drag. When using get_window_state, pass element_index with the same window_id.",
    "Use keyboard input when AX exposes focusable controls but not direct actions.",
    "For CEF/Chromium/WebGL/media surfaces that still expose only sparse window chrome after one re-observe, use the current get_app_state screenshot plus keyboard shortcuts before screenshot-coordinate clicks.",
    "Use coordinate actions only as a last resort. coordinate_space=screenshot is valid only for coordinates read from the current get_app_state screenshot; pass capture_id when available so stale coordinates can be rejected. Do not use browser, Playwright, full-screen, or stale screenshots.",
    "After every action, call get_app_state again and verify the observed UI before reporting success.",
  ],
};

const FALLBACK_INSTRUCTIONS = `# TermCanvas Computer Use

Use this MCP server for local Mac desktop automation. Follow the AX-first protocol:

1. Call status first. If the helper is not healthy or permissions are missing, call setup to start Computer Use and open the macOS permission flow.
2. If permissions remain false after the user says they already allowed them, guide the user to remove stale TermCanvas and computer-use-helper entries from both macOS permission panes, then add /Applications/TermCanvas.app and /Applications/TermCanvas.app/Contents/Resources/computer-use-helper again.
3. Use these tools for local macOS apps. Do not use browser automation or Playwright unless the target is a web page in a browser.
4. Call list_apps, then list_windows when you need to choose a concrete window. Prefer pid + window_id for get_window_state when available.
5. Call get_window_state or get_app_state before acting. If it is empty or sparse, re-activate and observe again before declaring a limitation.
6. Prefer indexed Accessibility elements and semantic AX actions from get_app_state.
7. For CEF/Chromium/WebGL/media surfaces that remain sparse after one re-observe, use the returned screenshot plus keyboard shortcuts before screenshot-coordinate clicks.
8. Use the returned screenshot for observation and use screenshot coordinates only as the last resort. Pass capture_id with screenshot-coordinate actions when available.
9. After every action, call get_app_state again and verify the result before reporting success.
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
