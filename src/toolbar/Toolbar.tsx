import { useCallback } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore, generateId } from "../stores/projectStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useDrawingStore, type DrawingTool } from "../stores/drawingStore";
import { useThemeStore } from "../stores/themeStore";

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const drawingTools: { id: DrawingTool; label: string; icon: string }[] = [
  { id: "select", label: "Select", icon: "↖" },
  { id: "pen", label: "Pen", icon: "✎" },
  { id: "text", label: "Text", icon: "T" },
  { id: "rect", label: "Rect", icon: "□" },
  { id: "arrow", label: "Arrow", icon: "→" },
];

const drawingColors = [
  "#ededed",
  "#0070f3",
  "#ee0000",
  "#f5a623",
  "#7928ca",
  "#50e3c2",
];

function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.termcanvas;
}

// Shared button style
const btn =
  "px-2 py-1 rounded-md text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors duration-150 active:scale-[0.97]";

export function Toolbar() {
  const { viewport, setViewport, resetViewport } = useCanvasStore();
  const { projects, addProject } = useProjectStore();
  const { notify } = useNotificationStore();
  const { tool, color, setTool, setColor, clearAll, elements } =
    useDrawingStore();
  const { theme, toggleTheme } = useThemeStore();

  const handleAddProject = useCallback(async () => {
    if (!isElectron()) {
      notify("error", "Not running in Electron. Cannot access native APIs.");
      return;
    }

    let dirPath: string | null;
    try {
      dirPath = await window.termcanvas.project.selectDirectory();
    } catch (err) {
      notify("error", `Failed to open directory picker: ${err}`);
      return;
    }

    if (!dirPath) return;

    let info: Awaited<ReturnType<typeof window.termcanvas.project.scan>>;
    try {
      info = await window.termcanvas.project.scan(dirPath);
    } catch (err) {
      notify("error", `Failed to scan project: ${err}`);
      return;
    }

    if (!info) {
      notify("warn", `"${dirPath}" is not a git repository.`);
      return;
    }

    addProject({
      id: generateId(),
      name: info.name,
      path: info.path,
      position: { x: 100 - viewport.x, y: 100 - viewport.y },
      size: { w: 620, h: 0 },
      collapsed: false,
      zIndex: 0,
      worktrees: info.worktrees.map((wt) => ({
        id: generateId(),
        name: wt.branch,
        path: wt.path,
        position: { x: 0, y: 0 },
        size: { w: 580, h: 0 },
        collapsed: false,
        terminals: [],
      })),
    });

    notify(
      "info",
      `Added project "${info.name}" with ${info.worktrees.length} worktree(s).`,
    );
  }, [addProject, viewport, notify]);

  const handleFitAll = useCallback(() => {
    if (projects.length === 0) return;
    const padding = 80;
    const toolbarH = 44;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of projects) {
      minX = Math.min(minX, p.position.x);
      minY = Math.min(minY, p.position.y);
      maxX = Math.max(maxX, p.position.x + (p.size.w || 620));
      maxY = Math.max(maxY, p.position.y + (p.size.h || 400));
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const viewW = window.innerWidth - padding * 2;
    const viewH = window.innerHeight - toolbarH - padding * 2;
    const scale = Math.min(1, viewW / contentW, viewH / contentH);
    setViewport({
      x: -minX * scale + padding,
      y: -minY * scale + padding + toolbarH,
      scale,
    });
  }, [projects, setViewport]);

  const zoomPercent = Math.round(viewport.scale * 100);

  return (
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

      {/* Actions */}
      <button
        className={`${btn} border border-[var(--border)]`}
        style={noDrag}
        onClick={handleAddProject}
      >
        Add Project
      </button>
      <button
        className={btn}
        style={noDrag}
        onClick={async () => {
          if (!window.termcanvas) return;
          const data = await window.termcanvas.workspace.open();
          if (data) {
            // Dispatch custom event for App to handle
            window.dispatchEvent(
              new CustomEvent("termcanvas:open-workspace", { detail: data }),
            );
          }
        }}
      >
        Open
      </button>

      {/* ── Drawing tools ── */}
      <div className="flex items-center gap-0.5 ml-2" style={noDrag}>
        {drawingTools.map((t) => (
          <button
            key={t.id}
            className={`px-2 py-1 rounded-md text-[13px] transition-colors duration-150 active:scale-[0.97] ${
              tool === t.id
                ? "bg-[var(--border)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)]"
            }`}
            onClick={() => setTool(t.id)}
            title={t.label}
          >
            {t.icon}
          </button>
        ))}
      </div>

      {/* Drawing colors */}
      <div className="flex items-center gap-1" style={noDrag}>
        {drawingColors.map((c) => (
          <button
            key={c}
            className="w-4 h-4 rounded-full transition-all duration-150"
            style={{
              backgroundColor: c,
              outline:
                color === c ? "1.5px solid #ededed" : "1.5px solid transparent",
              outlineOffset: 1,
            }}
            onClick={() => setColor(c)}
          />
        ))}
        {elements.length > 0 && (
          <button
            className="ml-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--red)] transition-colors duration-150"
            onClick={clearAll}
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex-1" />

      {/* Theme toggle */}
      <button
        className={btn}
        style={noDrag}
        onClick={toggleTheme}
        title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>

      {/* ── Zoom controls ── */}
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
          Reset
        </button>
        <button className={btn} onClick={handleFitAll}>
          Fit
        </button>
      </div>
    </div>
  );
}
