import type { RenderDiagnosticEventInput } from "../../shared/render-diagnostics";
import { useCanvasStore } from "../stores/canvasStore";

function getBaseDiagnosticData(): Record<string, unknown> {
  const canvasState = useCanvasStore.getState();
  const viewport = canvasState.viewport;
  return {
    canvas_animating: canvasState.isAnimating,
    device_pixel_ratio:
      typeof window !== "undefined" ? window.devicePixelRatio : null,
    document_focused:
      typeof document !== "undefined" &&
      typeof document.hasFocus === "function"
        ? document.hasFocus()
        : null,
    focus_level: canvasState.focusLevel,
    inner_height: typeof window !== "undefined" ? window.innerHeight : null,
    inner_width: typeof window !== "undefined" ? window.innerWidth : null,
    visibility_state:
      typeof document !== "undefined" ? document.visibilityState : null,
    viewport: viewport
      ? {
          scale: viewport.scale,
          x: viewport.x,
          y: viewport.y,
        }
      : null,
  };
}

export function recordRenderDiagnostic(
  input: RenderDiagnosticEventInput,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const diagnostics = window.termcanvas?.diagnostics;
  if (!diagnostics?.recordRenderEvent) {
    return;
  }

  void diagnostics
    .recordRenderEvent({
      ...input,
      data: {
        ...getBaseDiagnosticData(),
        ...(input.data ?? {}),
      },
    })
    .catch(() => {
      // Diagnostics logging is best-effort.
    });
}

let listenersInstalled = false;

export function installRenderDiagnosticsListeners(): void {
  if (
    listenersInstalled ||
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return;
  }

  listenersInstalled = true;

  window.addEventListener("focus", () => {
    recordRenderDiagnostic({
      kind: "renderer_window_focus",
    });
  });

  window.addEventListener("blur", () => {
    recordRenderDiagnostic({
      kind: "renderer_window_blur",
    });
  });

  if (
    typeof document !== "undefined" &&
    typeof document.addEventListener === "function"
  ) {
    document.addEventListener("visibilitychange", () => {
      recordRenderDiagnostic({
        kind: "renderer_visibility_change",
        data: {
          next_visibility_state: document.visibilityState,
        },
      });
    });
  }
}
