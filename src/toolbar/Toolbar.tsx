import { useCallback, useState } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { computeWorktreeSize, PROJ_PAD, PROJ_TITLE_H } from "../layout";
import { SettingsModal } from "../components/SettingsModal";
import { useT } from "../i18n/useT";

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const btn =
  "px-2 py-1 rounded-md text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors duration-150 active:scale-[0.97]";

export function Toolbar() {
  const { viewport, setViewport, resetViewport, animateTo } = useCanvasStore();
  const { projects } = useProjectStore();
  const t = useT();
  const [showSettings, setShowSettings] = useState(false);

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
        const wtSize = computeWorktreeSize(wt.terminals.length);
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
        className="fixed top-0 left-0 right-0 h-11 flex items-center pr-4 gap-3 z-50 bg-[var(--bg)] border-b border-[var(--border)]"
        style={
          { paddingLeft: 80, WebkitAppRegion: "drag" } as React.CSSProperties
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

        {/* Settings button */}
        <button
          className={btn}
          style={noDrag}
          onClick={() => setShowSettings(true)}
          title={t.settings}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle
              cx="7"
              cy="7"
              r="2"
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

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
