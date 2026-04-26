import { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import { useCanvasToolStore } from "../stores/canvasToolStore";
import {
  fitAllProjects,
  setZoomToHundred,
  stepZoomAtCenter,
} from "../canvas/zoomActions";
import {
  clampScale,
  getViewportCenterClientPoint,
  zoomAtClientPoint,
} from "../canvas/viewportZoom";
import { TOOLBAR_HEIGHT } from "./toolbarHeight";
import { useT } from "../i18n/useT";

const PILL_BG =
  "bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] backdrop-blur-md";
const PILL_BORDER = "border border-[var(--border)]";
const PILL_SHADOW =
  "shadow-[0_8px_24px_-12px_color-mix(in_srgb,#000_36%,transparent),0_2px_6px_-2px_color-mix(in_srgb,#000_24%,transparent)]";

const groupBase = "flex items-center";
const dividerCls =
  "h-4 w-px bg-[color-mix(in_srgb,var(--border)_72%,transparent)] mx-0.5";
const buttonBase =
  "inline-flex h-8 items-center justify-center rounded-md text-[12px] font-medium text-[var(--text-muted)] transition-[color,background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] hover:text-[var(--text-primary)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--text-secondary)_24%,transparent)] motion-reduce:transition-none";
const iconButton = `${buttonBase} w-8`;
const segmentButton = `${buttonBase} px-2.5 gap-1.5`;
const segmentActive =
  "bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] text-[var(--text-primary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border)_70%,transparent)]";
const zoomReadout =
  "min-w-[3.25rem] h-8 inline-flex items-center justify-center text-[11px] text-[var(--text-faint)] tabular-nums rounded-md hover:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] hover:text-[var(--text-primary)] transition-colors";

const ZOOM_PRESETS: Array<{ scale: number; label: string }> = [
  { scale: 0.5, label: "50%" },
  { scale: 1, label: "100%" },
  { scale: 2, label: "200%" },
];

export function BottomToolbar() {
  const t = useT();
  const tool = useCanvasToolStore((s) => s.tool);
  const setTool = useCanvasToolStore((s) => s.setTool);
  const viewport = useCanvasStore((s) => s.viewport);
  const [presetOpen, setPresetOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!presetOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setPresetOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [presetOpen]);

  const applyPreset = useCallback((nextScale: number) => {
    const {
      leftPanelCollapsed,
      leftPanelWidth,
      rightPanelCollapsed,
      rightPanelWidth,
      viewport: current,
    } = useCanvasStore.getState();
    const center = getViewportCenterClientPoint({
      leftPanelCollapsed,
      leftPanelWidth,
      rightPanelCollapsed,
      rightPanelWidth,
      topInset: TOOLBAR_HEIGHT,
    });
    useCanvasStore.getState().setViewport(
      zoomAtClientPoint({
        clientX: center.x,
        clientY: center.y,
        leftPanelCollapsed,
        leftPanelWidth,
        nextScale: clampScale(nextScale),
        viewport: current,
      }),
    );
  }, []);

  const zoomPercent = Math.round(viewport.scale * 100);

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-40 pointer-events-none"
      style={{ bottom: 20 }}
    >
      <div
        className={`pointer-events-auto inline-flex items-center gap-1 rounded-full px-2 py-1 ${PILL_BG} ${PILL_BORDER} ${PILL_SHADOW}`}
      >
        <div className={groupBase} role="group" aria-label={t.canvas_tool_select}>
          <button
            className={`${segmentButton} ${tool === "select" ? segmentActive : ""}`}
            onClick={() => setTool("select")}
            title={`${t.canvas_tool_select} (V)`}
            aria-label={t.canvas_tool_select}
            aria-pressed={tool === "select"}
          >
            <SelectIcon />
            <span className="text-[11px] font-mono opacity-60">V</span>
          </button>
          <button
            className={`${segmentButton} ${tool === "hand" ? segmentActive : ""}`}
            onClick={() => setTool("hand")}
            title={`${t.canvas_tool_hand} (H)`}
            aria-label={t.canvas_tool_hand}
            aria-pressed={tool === "hand"}
          >
            <HandIcon />
            <span className="text-[11px] font-mono opacity-60">H</span>
          </button>
        </div>

        <div aria-hidden="true" className={dividerCls} />

        <div className={groupBase}>
          <button
            className={iconButton}
            onClick={() => stepZoomAtCenter("out")}
            title={t.zoom_out}
            aria-label={t.zoom_out}
          >
            <span className="text-[14px] leading-none">−</span>
          </button>

          <div className="relative" ref={popoverRef}>
            <button
              className={zoomReadout}
              onClick={() => setPresetOpen((open) => !open)}
              title={t.canvas_zoom_to}
              aria-haspopup="menu"
              aria-expanded={presetOpen}
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              {zoomPercent}%
            </button>
            {presetOpen && (
              <div
                role="menu"
                className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 min-w-[140px] rounded-md py-1 ${PILL_BG} ${PILL_BORDER} ${PILL_SHADOW}`}
              >
                {ZOOM_PRESETS.map((preset) => (
                  <button
                    key={preset.scale}
                    role="menuitem"
                    className="flex w-full items-center justify-between px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] hover:text-[var(--text-primary)]"
                    onClick={() => {
                      applyPreset(preset.scale);
                      setPresetOpen(false);
                    }}
                  >
                    <span>{preset.label}</span>
                    <span className="text-[10px] font-mono text-[var(--text-faint)]">
                      {preset.scale === 1 ? "⌘0" : ""}
                    </span>
                  </button>
                ))}
                <div className="my-1 h-px bg-[var(--border)] opacity-60" />
                <button
                  role="menuitem"
                  className="flex w-full items-center justify-between px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] hover:text-[var(--text-primary)]"
                  onClick={() => {
                    fitAllProjects();
                    setPresetOpen(false);
                  }}
                >
                  <span>{t.fit}</span>
                  <span className="text-[10px] font-mono text-[var(--text-faint)]">
                    ⇧1
                  </span>
                </button>
              </div>
            )}
          </div>

          <button
            className={iconButton}
            onClick={() => stepZoomAtCenter("in")}
            title={t.zoom_in}
            aria-label={t.zoom_in}
          >
            <span className="text-[14px] leading-none">+</span>
          </button>
        </div>

        <div aria-hidden="true" className={dividerCls} />

        <button
          className={`${buttonBase} px-2.5`}
          onClick={fitAllProjects}
          title={t.fit}
          aria-label={t.fit}
        >
          {t.fit}
        </button>
      </div>
    </div>
  );
}

function SelectIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path
        d="M3 2.2v8.6l2.3-2.1 1.6 3.3 1.7-.8-1.6-3.3 3 .1L3 2.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function HandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path
        d="M4 6V2.7a.9.9 0 1 1 1.8 0V6m0 0V1.9a.9.9 0 1 1 1.8 0V6m0 0V2.4a.9.9 0 1 1 1.8 0V6m0 0V3.6a.9.9 0 1 1 1.8 0v4.6c0 2.3-1.7 3.6-3.5 3.6S2.5 10.5 2.5 8.5V6.5a.9.9 0 1 1 1.5-.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
