import { useCallback, useState } from "react";
import { createBrowserCardInScene } from "../actions/sceneCardActions";
import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useThemeStore } from "../stores/themeStore";
import { useUpdaterStore } from "../stores/updaterStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useSettingsModalStore } from "../stores/settingsModalStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { SettingsModal } from "../components/SettingsModal";
import { UpdateModal } from "../components/UpdateModal";
import { useT } from "../i18n/useT";
import { getWorkspaceBaseName } from "../titleHelper";
import {
  getCanvasLeftInset,
  getCanvasRightInset,
} from "../canvas/viewportBounds";
import {
  getNextZoomStep,
  getViewportCenterClientPoint,
  zoomAtClientPoint,
} from "../canvas/viewportZoom";

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
const platform = window.termcanvas?.app.platform ?? "darwin";
const isMac = platform === "darwin";
const isWin = platform === "win32";
export const TOOLBAR_HEIGHT = 44;

const controlRow =
  "relative z-10 flex items-center gap-2 text-[var(--text-secondary)]";
const controlSection = "flex items-center gap-0.5";
const controlDivider =
  "h-4 w-px bg-[color-mix(in_srgb,var(--border)_72%,transparent)]";
const buttonBase =
  "inline-flex h-7 items-center justify-center rounded-md text-[12px] font-medium text-[var(--text-muted)] transition-[color,background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] hover:text-[var(--text-primary)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--text-secondary)_24%,transparent)] motion-reduce:transition-none";
const iconButton = `${buttonBase} w-7`;
const textButton = `${buttonBase} px-2.5`;
const zoomReadout =
  "min-w-[3.25rem] text-center text-[11px] text-[var(--text-faint)] tabular-nums";

export function Toolbar({ onShowTutorial }: { onShowTutorial: () => void }) {
  const {
    viewport,
    setViewport,
    resetViewport,
    rightPanelCollapsed,
    rightPanelWidth,
    leftPanelCollapsed,
    leftPanelWidth,
  } = useCanvasStore();
  const { projects } = useProjectStore();
  const { theme, toggleTheme } = useThemeStore();
  const browserEnabled = usePreferencesStore((s) => s.browserEnabled);
  const t = useT();
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const dirty = useWorkspaceStore((s) => s.dirty);
  const updateStatus = useUpdaterStore((s) => s.status);
  const showSettings = useSettingsModalStore((s) => s.open);
  const openSettings = useSettingsModalStore((s) => s.openSettings);
  const closeSettings = useSettingsModalStore((s) => s.closeSettings);
  const [showUpdate, setShowUpdate] = useState(false);

  const handleFitAll = useCallback(() => {
    if (projects.length === 0) return;
    const padding = 80;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of projects) {
      for (const wt of p.worktrees) {
        for (const t of wt.terminals) {
          minX = Math.min(minX, t.x);
          minY = Math.min(minY, t.y);
          maxX = Math.max(maxX, t.x + t.width);
          maxY = Math.max(maxY, t.y + t.height);
        }
      }
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const rightOffset = getCanvasRightInset(rightPanelCollapsed, rightPanelWidth);
    const viewW = window.innerWidth - rightOffset - padding * 2;
    const viewH = window.innerHeight - TOOLBAR_HEIGHT - padding * 2;
    const scale = Math.min(1, viewW / contentW, viewH / contentH);
    const x = -minX * scale + padding;
    const y = -minY * scale + padding + TOOLBAR_HEIGHT;
    setViewport({ x, y, scale });
  }, [projects, rightPanelCollapsed, rightPanelWidth, setViewport]);

  const applyStepZoom = useCallback(
    (direction: "in" | "out") => {
      const nextScale = getNextZoomStep(viewport.scale, direction);
      const centerPoint = getViewportCenterClientPoint({
        leftPanelCollapsed,
        leftPanelWidth,
        rightPanelCollapsed,
        rightPanelWidth,
        topInset: TOOLBAR_HEIGHT,
      });

      setViewport(
        zoomAtClientPoint({
          clientX: centerPoint.x,
          clientY: centerPoint.y,
          leftPanelCollapsed,
          leftPanelWidth,
          nextScale,
          viewport,
        }),
      );
    },
    [
      leftPanelCollapsed,
      leftPanelWidth,
      rightPanelCollapsed,
      rightPanelWidth,
      setViewport,
      viewport,
    ],
  );

  const zoomPercent = Math.round(viewport.scale * 100);
  const workspaceName =
    getWorkspaceBaseName(workspacePath) ?? t.toolbar_untitled_workspace;

  return (
    <>
      <div
        className="fixed top-0 left-0 right-0 z-50 flex h-11 items-center gap-3 overflow-hidden border-b border-[var(--border)]"
        style={
          {
            paddingLeft: 16,
            paddingRight: isWin ? 140 : 16,
            WebkitAppRegion: "drag",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--bg) 95%, var(--surface) 5%) 0%, color-mix(in srgb, var(--bg) 98%, var(--surface) 2%) 100%)",
          } as React.CSSProperties
        }
      >
        {isMac && <div aria-hidden="true" className="w-[72px] shrink-0" />}

        <div className="flex flex-1 min-w-0 items-center justify-center">
          <div className="flex min-w-0 items-center gap-2 px-3 py-1">
            {dirty && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background:
                    "color-mix(in srgb, var(--text-secondary) 82%, transparent)",
                }}
              />
            )}
            <span
              className="min-w-0 truncate text-[12px] font-medium tracking-[0.01em] text-[var(--text-secondary)]"
              style={{
                textShadow:
                  "0 1px 0 color-mix(in srgb, var(--bg) 70%, transparent)",
              }}
            >
              {workspaceName}
            </span>
          </div>
        </div>

        <div className={controlRow} style={noDrag}>
          <div className={controlSection}>
            <button
              className={iconButton}
              onClick={onShowTutorial}
              title={t.tutorial}
              aria-label={t.tutorial}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle
                  cx="7"
                  cy="7"
                  r="5.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <path
                  d="M5 5.5a2 2 0 0 1 3.9.5c0 1-1.4 1.2-1.4 2"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="7" cy="10" r="0.6" fill="currentColor" />
              </svg>
            </button>

            <button
              className={iconButton}
              onClick={() => useCanvasStore.getState().openUsageOverlay()}
              title={t.usage_title}
              aria-label={t.usage_title}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect
                  x="1.5"
                  y="3"
                  width="3"
                  height="8"
                  rx="0.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <rect
                  x="5.5"
                  y="5"
                  width="3"
                  height="6"
                  rx="0.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <rect
                  x="9.5"
                  y="1"
                  width="3"
                  height="10"
                  rx="0.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            </button>

            <button
              className={iconButton}
              onClick={toggleTheme}
              title={theme === "dark" ? t.switch_to_light : t.switch_to_dark}
              aria-label={
                theme === "dark" ? t.switch_to_light : t.switch_to_dark
              }
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

            {updateStatus !== "idle" && (
              <button
                className={`${iconButton} relative`}
                onClick={() => setShowUpdate(true)}
                title={
                  updateStatus === "downloading"
                    ? t.update_downloading
                    : updateStatus === "ready"
                      ? t.update_ready
                      : updateStatus === "error"
                        ? t.update_error
                        : t.update_checking
                }
                aria-label={
                  updateStatus === "downloading"
                    ? t.update_downloading
                    : updateStatus === "ready"
                      ? t.update_ready
                      : updateStatus === "error"
                        ? t.update_error
                        : t.update_checking
                }
              >
                {updateStatus === "downloading" ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    className="animate-bounce"
                  >
                    <path
                      d="M7 2v8M4 7.5L7 10.5 10 7.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M3 12h8"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : updateStatus === "ready" ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M7 12V4M4 6.5L7 3.5 10 6.5"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M3 2h8"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-green-500" />
                  </>
                ) : updateStatus === "error" ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M7 2L1.5 12h11L7 2Z"
                      stroke="var(--amber)"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M7 6v3"
                      stroke="var(--amber)"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                    <circle cx="7" cy="10.5" r="0.6" fill="var(--amber)" />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    className="animate-spin"
                  >
                    <path
                      d="M7 1.5A5.5 5.5 0 1 1 1.5 7"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </button>
            )}

            <button
              className={iconButton}
              onClick={() => openSettings()}
              title={t.settings}
              aria-label={t.settings}
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

            {browserEnabled && (
              <button
                className={iconButton}
                onClick={() => {
                  const scale = viewport.scale;
                  const canvasCenterX =
                    getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth) +
                    (window.innerWidth -
                      getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth) -
                      getCanvasRightInset(rightPanelCollapsed, rightPanelWidth)) /
                      2;
                  const x = (-viewport.x + canvasCenterX) / scale - 400;
                  const y =
                    (-viewport.y + window.innerHeight / 2) / scale - 300;
                  createBrowserCardInScene("https://google.com", { x, y });
                }}
                title={t.add_browser}
                aria-label={t.add_browser}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle
                    cx="7"
                    cy="7"
                    r="5.5"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                  <path
                    d="M1.5 7h11M7 1.5c-1.5 2-2 3.5-2 5.5s.5 3.5 2 5.5M7 1.5c1.5 2 2 3.5 2 5.5s-.5 3.5-2 5.5"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                </svg>
              </button>
            )}
          </div>

          <div aria-hidden="true" className={controlDivider} />

          <div className={controlSection}>
            <button
              className={iconButton}
              onClick={() => applyStepZoom("out")}
              title={t.zoom_out}
              aria-label={t.zoom_out}
            >
              −
            </button>
            <span
              className={zoomReadout}
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              {zoomPercent}%
            </span>
            <button
              className={iconButton}
              onClick={() => applyStepZoom("in")}
              title={t.zoom_in}
              aria-label={t.zoom_in}
            >
              +
            </button>
            <div aria-hidden="true" className={controlDivider} />
            <button className={textButton} onClick={resetViewport}>
              {t.reset}
            </button>
            <button className={textButton} onClick={handleFitAll}>
              {t.fit}
            </button>
          </div>
        </div>
      </div>

      {showSettings && <SettingsModal onClose={closeSettings} />}
      {showUpdate && <UpdateModal onClose={() => setShowUpdate(false)} />}
    </>
  );
}
