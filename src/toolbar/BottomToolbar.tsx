import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCanvasStore } from "../stores/canvasStore";
import {
  useCanvasToolStore,
  type CanvasTool,
} from "../stores/canvasToolStore";
import { usePreferencesStore } from "../stores/preferencesStore";
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

// ComposerBar sits at `bottom-4` (16 px) and is roughly 120 px tall;
// when it's mounted we float above it with an 8 px gap so the pill is
// never obscured. Drops back to `bottom: 20` when the composer is off.
const BOTTOM_OFFSET_WITH_COMPOSER = 16 + 120 + 8;
const BOTTOM_OFFSET_PLAIN = 20;

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
const zoomReadout =
  "min-w-[3.25rem] h-8 inline-flex items-center justify-center text-[11px] text-[var(--text-faint)] tabular-nums rounded-md hover:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] hover:text-[var(--text-primary)] transition-colors";

const platform = window.termcanvas?.app.platform ?? "darwin";
const isMac = platform === "darwin";

// One source of truth for the shortcut text shown in this toolbar's
// menus. Keep aligned with the bindings registered in
// useKeyboardShortcuts.ts (Cmd+0 fits, Cmd+1 = 100%, etc.).
const KEY_HINT = {
  fit: isMac ? "⌘0" : "Ctrl 0",
  zoom100: isMac ? "⌘1" : "Ctrl 1",
};

type ZoomPreset = {
  scale: number;
  label: string;
  hint?: string;
};

const ZOOM_PRESETS: ZoomPreset[] = [
  { scale: 0.5, label: "50%" },
  { scale: 1, label: "100%", hint: KEY_HINT.zoom100 },
  { scale: 2, label: "200%" },
];

function useCloseOnOutsideClick(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", handle);
    return () => window.removeEventListener("mousedown", handle);
  }, [open, ref, close]);
}

// Roving-focus keyboard nav for popover menus. Caller passes a ref to
// the popover container, the trigger button (so we can return focus
// when Esc closes the menu), and an item count for arrow-key wrap.
function usePopoverKeyboardNav({
  open,
  popoverRef,
  triggerRef,
  itemCount,
  initialIndex = 0,
  close,
}: {
  open: boolean;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  itemCount: number;
  initialIndex?: number;
  close: () => void;
}): void {
  useEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    if (!popover) return;

    const items = () =>
      Array.from(
        popover.querySelectorAll<HTMLElement>("[data-popover-item]"),
      );

    // Focus the requested item once mounted (rAF lets the popover
    // paint first, otherwise focus flashes briefly to the trigger).
    const raf = requestAnimationFrame(() => {
      const list = items();
      list[Math.min(initialIndex, Math.max(0, list.length - 1))]?.focus();
    });

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const list = items();
      if (list.length === 0) return;
      const current = list.findIndex((el) => el === document.activeElement);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const fallback = e.key === "ArrowDown" ? 0 : list.length - 1;
      const next =
        current < 0 ? fallback : (current + delta + list.length) % list.length;
      list[next].focus();
    };

    window.addEventListener("keydown", handler);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", handler);
    };
  }, [open, popoverRef, triggerRef, itemCount, initialIndex, close]);
}

export function BottomToolbar() {
  const t = useT();
  const tool = useCanvasToolStore((s) => s.tool);
  const setTool = useCanvasToolStore((s) => s.setTool);
  const viewport = useCanvasStore((s) => s.viewport);
  const composerEnabled = usePreferencesStore((s) => s.composerEnabled);

  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const toolMenuWrapperRef = useRef<HTMLDivElement>(null);
  const toolMenuPopoverRef = useRef<HTMLDivElement>(null);
  const toolTriggerRef = useRef<HTMLButtonElement>(null);
  const presetWrapperRef = useRef<HTMLDivElement>(null);
  const presetPopoverRef = useRef<HTMLDivElement>(null);
  const presetTriggerRef = useRef<HTMLButtonElement>(null);

  const closeToolMenu = useCallback(() => setToolMenuOpen(false), []);
  const closePresetMenu = useCallback(() => setPresetOpen(false), []);

  useCloseOnOutsideClick(toolMenuOpen, toolMenuWrapperRef, closeToolMenu);
  useCloseOnOutsideClick(presetOpen, presetWrapperRef, closePresetMenu);

  const toolOptions = useMemo<
    Array<{
      id: CanvasTool;
      label: string;
      shortcut: string;
      icon: React.ReactNode;
    }>
  >(
    () => [
      {
        id: "select",
        label: t.canvas_tool_select,
        shortcut: "V",
        icon: <SelectIcon />,
      },
      {
        id: "hand",
        label: t.canvas_tool_hand,
        shortcut: "H",
        icon: <HandIcon />,
      },
    ],
    [t.canvas_tool_select, t.canvas_tool_hand],
  );

  usePopoverKeyboardNav({
    open: toolMenuOpen,
    popoverRef: toolMenuPopoverRef,
    triggerRef: toolTriggerRef,
    itemCount: toolOptions.length,
    initialIndex: Math.max(
      0,
      toolOptions.findIndex((opt) => opt.id === tool),
    ),
    close: closeToolMenu,
  });
  usePopoverKeyboardNav({
    open: presetOpen,
    popoverRef: presetPopoverRef,
    triggerRef: presetTriggerRef,
    // +1 for the Fit row appended after the presets.
    itemCount: ZOOM_PRESETS.length + 1,
    close: closePresetMenu,
  });

  const applyPreset = useCallback((nextScale: number) => {
    if (nextScale === 1) {
      setZoomToHundred();
      return;
    }
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
  const activeTool =
    toolOptions.find((opt) => opt.id === tool) ?? toolOptions[0];

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[95] pointer-events-none"
      style={{
        bottom: composerEnabled
          ? BOTTOM_OFFSET_WITH_COMPOSER
          : BOTTOM_OFFSET_PLAIN,
      }}
    >
      <div
        className={`pointer-events-auto inline-flex items-center gap-1 rounded-full px-2 py-1 ${PILL_BG} ${PILL_BORDER} ${PILL_SHADOW}`}
      >
        <div className="relative" ref={toolMenuWrapperRef}>
          <button
            ref={toolTriggerRef}
            className={`${buttonBase} px-2 gap-1`}
            onClick={() => setToolMenuOpen((open) => !open)}
            title={`${activeTool.label} (${activeTool.shortcut})`}
            aria-haspopup="menu"
            aria-expanded={toolMenuOpen}
            aria-label={activeTool.label}
          >
            {activeTool.icon}
            <CaretIcon open={toolMenuOpen} />
          </button>
          {toolMenuOpen && (
            <div
              ref={toolMenuPopoverRef}
              role="menu"
              aria-label={t.canvas_tool_select}
              className={`absolute bottom-full left-0 mb-2 min-w-[160px] rounded-md py-1 ${PILL_BG} ${PILL_BORDER} ${PILL_SHADOW}`}
            >
              {toolOptions.map((opt) => {
                const active = opt.id === tool;
                return (
                  <button
                    key={opt.id}
                    data-popover-item
                    role="menuitemradio"
                    aria-checked={active}
                    tabIndex={-1}
                    className={`flex w-full items-center gap-3 px-2.5 py-1.5 text-[12px] transition-colors focus:outline-none ${
                      active
                        ? "text-[var(--text-primary)] bg-[color-mix(in_srgb,var(--surface)_72%,transparent)]"
                        : "text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] focus:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] hover:text-[var(--text-primary)] focus:text-[var(--text-primary)]"
                    }`}
                    onClick={() => {
                      setTool(opt.id);
                      closeToolMenu();
                      toolTriggerRef.current?.focus();
                    }}
                  >
                    <span className="w-4 inline-flex items-center justify-center">
                      {active ? <CheckIcon /> : null}
                    </span>
                    <span className="inline-flex items-center justify-center w-4">
                      {opt.icon}
                    </span>
                    <span className="flex-1 text-left">{opt.label}</span>
                    <span className="text-[10px] font-mono text-[var(--text-faint)]">
                      {opt.shortcut}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
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

          <div className="relative" ref={presetWrapperRef}>
            <button
              ref={presetTriggerRef}
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
                ref={presetPopoverRef}
                role="menu"
                aria-label={t.canvas_zoom_to}
                className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 min-w-[140px] rounded-md py-1 ${PILL_BG} ${PILL_BORDER} ${PILL_SHADOW}`}
              >
                {ZOOM_PRESETS.map((preset) => (
                  <button
                    key={preset.scale}
                    data-popover-item
                    role="menuitem"
                    tabIndex={-1}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] focus:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] hover:text-[var(--text-primary)] focus:text-[var(--text-primary)] focus:outline-none"
                    onClick={() => {
                      applyPreset(preset.scale);
                      closePresetMenu();
                      presetTriggerRef.current?.focus();
                    }}
                  >
                    <span>{preset.label}</span>
                    <span className="text-[10px] font-mono text-[var(--text-faint)]">
                      {preset.hint ?? ""}
                    </span>
                  </button>
                ))}
                <div className="my-1 h-px bg-[var(--border)] opacity-60" />
                <button
                  data-popover-item
                  role="menuitem"
                  tabIndex={-1}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] focus:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] hover:text-[var(--text-primary)] focus:text-[var(--text-primary)] focus:outline-none"
                  onClick={() => {
                    fitAllProjects();
                    closePresetMenu();
                    presetTriggerRef.current?.focus();
                  }}
                >
                  <span>{t.fit}</span>
                  <span className="text-[10px] font-mono text-[var(--text-faint)]">
                    {KEY_HINT.fit}
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
          title={`${t.fit} (${KEY_HINT.fit})`}
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

function CaretIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 8 8"
      fill="none"
      className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path
        d="M1.5 3l2.5 2.5L6.5 3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
      <path
        d="M2 5.8L4.4 8.2L9 3.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
