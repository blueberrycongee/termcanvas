import { useCanvasStore, COLLAPSED_TAB_WIDTH, RIGHT_PANEL_WIDTH } from "../stores/canvasStore";
import type { RightPanelTab } from "../stores/canvasStore";
import { UsagePanel } from "./UsagePanel";
import { SessionsPanel } from "./SessionsPanel";

const TABS: { id: RightPanelTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "sessions",
    label: "Sessions",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="4" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7.5 4.5h4M7.5 7h3M7.5 9.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "usage",
    label: "Usage",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1.5" y="3" width="3" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
        <rect x="5.5" y="5" width="3" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
        <rect x="9.5" y="1" width="3" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
];

export function RightPanel() {
  const collapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const setCollapsed = useCanvasStore((s) => s.setRightPanelCollapsed);
  const activeTab = useCanvasStore((s) => s.rightPanelActiveTab);
  const setActiveTab = useCanvasStore((s) => s.setRightPanelActiveTab);

  return (
    <div className="fixed right-0 z-40 flex" style={{ top: 44, height: "calc(100vh - 44px)" }}>
      {/* Collapsed tab strip */}
      <div
        className="shrink-0 flex flex-col items-center pt-2 gap-1 bg-[var(--sidebar)] overflow-hidden border-l border-[var(--border)]"
        style={{
          width: collapsed ? COLLAPSED_TAB_WIDTH : 0,
          transition: "width 0.2s ease",
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`flex flex-col items-center py-2 px-1 rounded cursor-pointer hover:bg-[var(--sidebar-hover)] ${
              activeTab === tab.id ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
            }`}
            onClick={() => {
              setActiveTab(tab.id);
              setCollapsed(false);
            }}
            title={tab.label}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      {/* Expanded panel */}
      <div
        className="shrink-0 flex flex-col bg-[var(--sidebar)] overflow-hidden border-l border-[var(--border)]"
        style={{
          width: collapsed ? 0 : RIGHT_PANEL_WIDTH,
          transition: "width 0.2s ease",
        }}
      >
        {/* Tab bar */}
        <div className="shrink-0 flex items-center border-b border-[var(--border)] h-[34px]">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`flex-1 flex items-center justify-center gap-1.5 h-full text-[10px] uppercase tracking-wider cursor-pointer border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-[var(--accent)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
              onClick={() => setActiveTab(tab.id)}
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
          <button
            className="shrink-0 px-2 h-full text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            onClick={() => setCollapsed(true)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0">
          {activeTab === "usage" && <UsagePanel />}
          {activeTab === "sessions" && <SessionsPanel />}
        </div>
      </div>
    </div>
  );
}
