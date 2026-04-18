import { useCallback } from "react";
import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import type { RightPanelTab } from "../stores/canvasStore";
import { UsagePanel } from "./UsagePanel";
import { SessionsPanel } from "./SessionsPanel";
import { IconButton } from "./ui/IconButton";
import { useT } from "../i18n/useT";
import { useSidebarDragStore } from "../stores/sidebarDragStore";

// Min/max drag range for the right panel. Mirrors the left panel's
// 200–600 clamp so the two sides feel symmetric. Upper bound is wide
// enough to read a markdown transcript; lower bound keeps the nav
// rail from disappearing behind a too-narrow tab column.
const MIN_RIGHT_WIDTH = 240;
const MAX_RIGHT_WIDTH = 800;

const TAB_ICONS: Record<RightPanelTab, React.ReactNode> = {
  sessions: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="4" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7.5 4.5h4M7.5 7h3M7.5 9.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  usage: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="3" width="3" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="5.5" y="5" width="3" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.5" y="1" width="3" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
};

const TAB_IDS: RightPanelTab[] = ["sessions", "usage"];

export function RightPanel() {
  const collapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const setCollapsed = useCanvasStore((s) => s.setRightPanelCollapsed);
  const activeTab = useCanvasStore((s) => s.rightPanelActiveTab);
  const setActiveTab = useCanvasStore((s) => s.setRightPanelActiveTab);
  const width = useCanvasStore((s) => s.rightPanelWidth);
  const setWidth = useCanvasStore((s) => s.setRightPanelWidth);
  const resizing = useSidebarDragStore((s) => s.active);
  const t = useT();

  const tabLabels: Record<RightPanelTab, string> = {
    sessions: t.sessions_tab,
    usage: t.usage_title,
  };

  // Symmetric with LeftPanel.handleResizeStart: dragging the inner
  // edge (which is the LEFT edge here, since the panel is anchored
  // right) grows the panel as the pointer moves left. Sign flipped
  // vs. left panel because clientX - startX is negative when pulling
  // leftward and we want that to INCREASE width.
  const handleResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget as HTMLElement;
      const pid = e.pointerId;
      handle.setPointerCapture(pid);
      const startX = e.clientX;
      const origW = width;
      useSidebarDragStore.getState().setActive(true);
      const handleMove = (ev: PointerEvent) => {
        setWidth(
          Math.max(
            MIN_RIGHT_WIDTH,
            Math.min(MAX_RIGHT_WIDTH, origW - (ev.clientX - startX)),
          ),
        );
      };
      const cleanup = () => {
        handle.removeEventListener("pointermove", handleMove);
        handle.removeEventListener("pointerup", cleanup);
        handle.removeEventListener("pointercancel", cleanup);
        handle.removeEventListener("lostpointercapture", cleanup);
        try {
          handle.releasePointerCapture(pid);
        } catch {}
        useSidebarDragStore.getState().setActive(false);
      };
      handle.addEventListener("pointermove", handleMove);
      handle.addEventListener("pointerup", cleanup);
      handle.addEventListener("pointercancel", cleanup);
      handle.addEventListener("lostpointercapture", cleanup);
    },
    [width, setWidth],
  );

  return (
    <div className="fixed right-0 z-40 flex" style={{ top: 44, height: "calc(100vh - 44px)" }}>
      <div
        className="h-full shrink-0 flex flex-col items-center pt-2 gap-1 bg-[var(--sidebar)] overflow-hidden border-l border-[var(--border)] cursor-pointer hover:bg-[var(--sidebar-hover)]"
        style={{
          width: collapsed ? COLLAPSED_TAB_WIDTH : 0,
          transition: "width 0.2s ease",
        }}
        onClick={() => setCollapsed(false)}
      >
        {TAB_IDS.map((id) => (
          // Collapsed-rail buttons are not real tabs (no tabpanel is
          // visible while collapsed) — they expand the panel and pick a
          // tab in one shot. Treat them as plain buttons with a clear
          // label, not as tab/toggle widgets.
          <button
            key={id}
            type="button"
            title={tabLabels[id]}
            aria-label={tabLabels[id]}
            className={`flex flex-col items-center py-2 px-1 rounded cursor-pointer hover:bg-[var(--sidebar-hover)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] ${
              activeTab === id ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
            }`}
            onClick={() => {
              setActiveTab(id);
              setCollapsed(false);
            }}
          >
            {TAB_ICONS[id]}
          </button>
        ))}
      </div>

      <div
        className="relative shrink-0 flex flex-col bg-[var(--sidebar)] overflow-hidden border-l border-[var(--border)]"
        style={{
          width: collapsed ? 0 : width,
          transition: resizing ? "none" : "width 0.2s ease",
        }}
      >
        {!collapsed && (
          <div
            className="absolute top-0 left-0 w-1.5 h-full cursor-ew-resize group/resize z-10"
            onPointerDown={handleResizeStart}
          >
            <div className="absolute left-0 top-0 w-px h-full bg-[var(--border)] group-hover/resize:bg-[var(--accent)] group-hover/resize:opacity-70 transition-colors duration-150" />
          </div>
        )}
        <div
          role="tablist"
          aria-label={t.sessions_panel_title}
          className="shrink-0 flex items-center border-b border-[var(--border)] h-[34px]"
        >
          {TAB_IDS.map((id) => {
            const selected = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`right-panel-tab-${id}`}
                aria-selected={selected}
                aria-controls={`right-panel-tabpanel-${id}`}
                tabIndex={selected ? 0 : -1}
                className={`flex-1 flex items-center justify-center gap-1.5 h-full text-[10px] uppercase tracking-wider cursor-pointer border-b-2 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
                  selected
                    ? "border-[var(--accent)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
                onClick={() => setActiveTab(id)}
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {TAB_ICONS[id]}
                {tabLabels[id]}
              </button>
            );
          })}
          <IconButton
            size="md"
            tone="neutral"
            label={t.right_panel_collapse}
            onClick={() => setCollapsed(true)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconButton>
        </div>

        <div
          role="tabpanel"
          id={`right-panel-tabpanel-${activeTab}`}
          aria-labelledby={`right-panel-tab-${activeTab}`}
          className="flex-1 min-h-0"
        >
          {activeTab === "usage" && <UsagePanel />}
          {activeTab === "sessions" && <SessionsPanel />}
        </div>
      </div>
    </div>
  );
}
