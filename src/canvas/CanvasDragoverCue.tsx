import { useT } from "../i18n/useT";
import { COLLAPSED_TAB_WIDTH, useCanvasStore } from "../stores/canvasStore";
import { TOOLBAR_HEIGHT } from "../toolbar/toolbarHeight";

interface CanvasDragoverCueProps {
  active: boolean;
  showChip: boolean;
}

/**
 * Two coordinated cues for OS-folder dragover:
 *  - A 1px accent inset around the canvas viewport — "the surface is
 *    receptive". Always shows when a file is dragged; doesn't depend on
 *    folder detection. Quiet enough to not claim territory.
 *  - A small floating chip at top-center — only when the dragged item is
 *    detected as a folder, communicating *what* the drop will do.
 *
 * Both elements stay mounted and animate via the `data-active` attribute.
 * Asymmetric timing — entrance uses --duration-quick (140ms), exit uses
 * --duration-instant (80ms) — is encoded in the CSS so the cue arrives
 * deliberately and disappears before the user notices.
 */
export function CanvasDragoverCue({ active, showChip }: CanvasDragoverCueProps) {
  const t = useT();
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const rightPanelWidth = useCanvasStore((s) => s.rightPanelWidth);

  const leftInset = leftPanelCollapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth;
  const rightInset = rightPanelCollapsed
    ? COLLAPSED_TAB_WIDTH
    : rightPanelWidth;

  return (
    <>
      <div
        aria-hidden="true"
        className="tc-canvas-dragover-inset"
        data-active={active ? "true" : "false"}
      />
      <div
        className="fixed pointer-events-none flex justify-center"
        style={{
          top: TOOLBAR_HEIGHT + 12,
          left: leftInset,
          right: rightInset,
          zIndex: 35,
        }}
      >
        <div
          role="status"
          aria-live="polite"
          className="tc-canvas-dragover-chip flex items-center gap-2.5 rounded-full border px-3 py-1 backdrop-blur-sm"
          data-active={showChip ? "true" : "false"}
        >
          <span
            aria-hidden
            className="inline-block w-1 h-1 rounded-full shrink-0"
            style={{ background: "var(--accent)" }}
          />
          <span
            className="tc-meta whitespace-nowrap"
            style={{ color: "var(--accent)" }}
          >
            {t.canvas_dragover_chip}
          </span>
        </div>
      </div>
    </>
  );
}
