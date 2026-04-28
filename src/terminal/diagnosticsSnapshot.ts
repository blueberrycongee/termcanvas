import type { RendererSnapshot } from "../../shared/diagnostics-snapshot";
import { getTerminalDiagnosticSnapshots } from "./terminalRuntimeStore";
import { getWebGLPoolDiagnosticSnapshot } from "./webglContextPool";

// Collect the renderer-side half of the diagnostics snapshot. Pure data:
// no IPC, no side effects. The main process collects its own half and
// concatenates them via `buildSnapshot()` in `electron/diagnostics-snapshot.ts`.
//
// All fields here go through narrow getters (`getTerminalDiagnosticSnapshots`,
// `getWebGLPoolDiagnosticSnapshot`) that enforce the allowlist — adding a
// field requires touching the schema in `shared/diagnostics-snapshot.ts`,
// which is the single audit point.
export function collectRendererSnapshot(): RendererSnapshot {
  const visibilityState =
    typeof document !== "undefined" ? document.visibilityState : "unknown";
  const documentFocused =
    typeof document !== "undefined" &&
    typeof document.hasFocus === "function"
      ? document.hasFocus()
      : false;
  const devicePixelRatio =
    typeof window !== "undefined" ? window.devicePixelRatio : 1;
  const innerWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  const innerHeight = typeof window !== "undefined" ? window.innerHeight : 0;

  return {
    visibilityState,
    documentFocused,
    devicePixelRatio,
    innerWidth,
    innerHeight,
    terminals: getTerminalDiagnosticSnapshots(),
    webglPool: getWebGLPoolDiagnosticSnapshot(),
  };
}
