import { useCallback, useState } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useThemeStore } from "../stores/themeStore";
import { useBrowserCardStore } from "../stores/browserCardStore";
import { useUpdaterStore } from "../stores/updaterStore";
import { useSettingsModalStore } from "../stores/settingsModalStore";
import { computeWorktreeSize, PROJ_PAD, PROJ_TITLE_H } from "../layout";
import { SettingsModal } from "../components/SettingsModal";
import { UpdateModal } from "../components/UpdateModal";
import { useT } from "../i18n/useT";

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
const platform = window.termcanvas?.app.platform ?? "darwin";

const btn =
  "px-2 py-1 rounded-md text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors duration-150 active:scale-[0.97]";

export function Toolbar({ onShowTutorial }: { onShowTutorial: () => void }) {
  const { viewport, setViewport, resetViewport, animateTo } = useCanvasStore();
  const { projects } = useProjectStore();
  const { theme, toggleTheme } = useThemeStore();
  const t = useT();
  const addBrowserCard = useBrowserCardStore((s) => s.addCard);
  const updateStatus = useUpdaterStore((s) => s.status);
  const showSettings = useSettingsModalStore((s) => s.open);
  const openSettings = useSettingsModalStore((s) => s.openSettings);
  const closeSettings = useSettingsModalStore((s) => s.closeSettings);
  const [showUpdate, setShowUpdate] = useState(false);

  const handleFitAll = useCallback(() => {
    if (projects.length === 0) return;
    const padding = 80;
    const toolbarH = 44;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of projects) {
      let maxW = 300;
      let totalH = 0;
      for (const wt of p.worktrees) {
        const wtSize = computeWorktreeSize(wt.terminals.map((t) => t.span));
        maxW = Math.max(maxW, wt.position.x + wtSize.w);
        totalH = Math.max(totalH, wt.position.y + wtSize.h);
      }
      const projW = Math.max(340, maxW + PROJ_PAD * 2);
      const projH = Math.max(
        PROJ_TITLE_H + PROJ_PAD + 60 + PROJ_PAD,
        PROJ_TITLE_H + PROJ_PAD + totalH + PROJ_PAD,
      );
      minX = Math.min(minX, p.position.x);
      minY = Math.min(minY, p.position.y);
      maxX = Math.max(maxX, p.position.x + projW);
      maxY = Math.max(maxY, p.position.y + projH);
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const viewW = window.innerWidth - padding * 2;
    const viewH = window.innerHeight - toolbarH - padding * 2;
    const scale = Math.min(1, viewW / contentW, viewH / contentH);
    const x = -minX * scale + padding;
    const y = -minY * scale + padding + toolbarH;
    animateTo(x, y, scale);
  }, [projects, animateTo]);

  const zoomPercent = Math.round(viewport.scale * 100);

  return (
    <>
      <div
        className="fixed top-0 left-0 right-0 h-11 flex items-center gap-3 z-50 bg-[var(--bg)] border-b border-[var(--border)]"
        style={
          {
            // macOS: leave space for traffic lights on the left
            // Windows: leave space for window controls overlay on the right
            paddingLeft: platform === "darwin" ? 80 : 16,
            paddingRight: platform === "win32" ? 140 : 16,
            WebkitAppRegion: "drag",
          } as React.CSSProperties
        }
      >
        {/* Branding */}
        <span
          className="text-[13px] font-medium text-[var(--text-primary)] tracking-tight"
          style={noDrag}
        >
          TermCanvas
        </span>

        <div className="flex-1" />

        {/* Tutorial */}
        <button
          className={btn}
          style={noDrag}
          onClick={onShowTutorial}
          title={t.tutorial}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 5.5a2 2 0 0 1 3.9.5c0 1-1.4 1.2-1.4 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="7" cy="10" r="0.6" fill="currentColor" />
          </svg>
        </button>

        {/* Usage panel toggle */}
        <button
          className={btn}
          style={noDrag}
          onClick={() => {
            const { rightPanelCollapsed, setRightPanelCollapsed } = useCanvasStore.getState();
            setRightPanelCollapsed(!rightPanelCollapsed);
          }}
          title={t.usage_title}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1.5" y="3" width="3" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
            <rect x="5.5" y="5" width="3" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
            <rect x="9.5" y="1" width="3" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>

        {/* Theme toggle */}
        <button
          className={btn}
          style={noDrag}
          onClick={toggleTheme}
          title={theme === "dark" ? t.switch_to_light : t.switch_to_dark}
        >
          {theme === "dark" ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle
                cx="7"
                cy="7"
                r="2.5"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M2.93 11.07l1.06-1.06M10.01 3.99l1.06-1.06"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M12.5 8.5a5.5 5.5 0 0 1-7-7 5.5 5.5 0 1 0 7 7Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        {/* Update indicator */}
        {updateStatus !== "idle" && (
          <button
            className={`${btn} relative`}
            style={noDrag}
            onClick={() => setShowUpdate(true)}
            title={
              updateStatus === "downloading" ? t.update_downloading
              : updateStatus === "ready" ? t.update_ready
              : updateStatus === "error" ? t.update_error
              : t.update_checking
            }
          >
            {updateStatus === "downloading" ? (
              // Downloading: animated arrow-down
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="animate-bounce">
                <path d="M7 2v8M4 7.5L7 10.5 10 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 12h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            ) : updateStatus === "ready" ? (
              // Ready: arrow-up with green dot
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 12V4M4 6.5L7 3.5 10 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 2h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-green-500" />
              </>
            ) : updateStatus === "error" ? (
              // Error: warning triangle
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2L1.5 12h11L7 2Z" stroke="var(--amber)" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M7 6v3" stroke="var(--amber)" strokeWidth="1.3" strokeLinecap="round" />
                <circle cx="7" cy="10.5" r="0.6" fill="var(--amber)" />
              </svg>
            ) : (
              // Checking: spinner-like
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="animate-spin">
                <path d="M7 1.5A5.5 5.5 0 1 1 1.5 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            )}
          </button>
        )}

        {/* Settings button */}
        <button
          className={btn}
          style={noDrag}
          onClick={() => openSettings()}
          title={t.settings}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M5.7 1h2.6l.4 1.7a4.5 4.5 0 0 1 1.1.6l1.7-.5 1.3 2.2-1.3 1.2a4.5 4.5 0 0 1 0 1.2l1.3 1.2-1.3 2.3-1.7-.6a4.5 4.5 0 0 1-1.1.7L8.3 13H5.7l-.4-1.7a4.5 4.5 0 0 1-1.1-.7l-1.7.6-1.3-2.3 1.3-1.2a4.5 4.5 0 0 1 0-1.2L1.2 5.3l1.3-2.2 1.7.5a4.5 4.5 0 0 1 1.1-.6L5.7 1Z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <circle
              cx="7"
              cy="7"
              r="1.8"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </button>

        {/* Add browser */}
        <button
          className={btn}
          style={noDrag}
          onClick={() => {
            const scale = viewport.scale;
            const x = (-viewport.x + window.innerWidth / 2) / scale - 400;
            const y = (-viewport.y + window.innerHeight / 2) / scale - 300;
            addBrowserCard("https://google.com", { x, y });
          }}
          title={t.add_browser}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M1.5 7h11M7 1.5c-1.5 2-2 3.5-2 5.5s.5 3.5 2 5.5M7 1.5c1.5 2 2 3.5 2 5.5s-.5 3.5-2 5.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5" style={noDrag}>
          <button
            className={btn}
            onClick={() =>
              setViewport({ scale: Math.max(0.1, viewport.scale * 0.9) })
            }
          >
            −
          </button>
          <span
            className="text-[11px] text-[var(--text-secondary)] w-10 text-center tabular-nums"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {zoomPercent}%
          </span>
          <button
            className={btn}
            onClick={() =>
              setViewport({ scale: Math.min(2, viewport.scale * 1.1) })
            }
          >
            +
          </button>
          <button className={btn} onClick={resetViewport}>
            {t.reset}
          </button>
          <button className={btn} onClick={handleFitAll}>
            {t.fit}
          </button>
        </div>
      </div>

      {showSettings && <SettingsModal onClose={closeSettings} />}
      {showUpdate && <UpdateModal onClose={() => setShowUpdate(false)} />}
    </>
  );
}
