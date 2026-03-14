import { useCallback } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore, generateId } from "../stores/projectStore";
import { useNotificationStore } from "../stores/notificationStore";

function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.termcanvas;
}

export function Toolbar() {
  const { viewport, setViewport, resetViewport } = useCanvasStore();
  const { projects, addProject } = useProjectStore();
  const { notify } = useNotificationStore();

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
      className="fixed top-0 left-0 right-0 h-11 toolbar flex items-center pr-4 gap-4 z-50"
      style={
        { paddingLeft: 80, WebkitAppRegion: "drag" } as React.CSSProperties
      }
    >
      {/* App branding - after macOS traffic lights */}
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect
            x="1"
            y="1"
            width="14"
            height="14"
            rx="3"
            stroke="#ededed"
            strokeWidth="1.5"
          />
          <path
            d="M5 8L7 10L11 6"
            stroke="#ededed"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[13px] font-medium tracking-tight text-[#ededed]">
          TermCanvas
        </span>
      </div>

      <div className="h-4 w-px bg-[#333]" />

      {/* Actions */}
      <button
        className="btn-geist"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        onClick={handleAddProject}
      >
        Add Project
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Zoom controls */}
      <div
        className="flex items-center gap-0 border border-[#333] rounded-md overflow-hidden"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          className="text-[#888] hover:text-[#ededed] hover:bg-[#1a1a1a] transition-colors px-2.5 py-1 text-xs"
          onClick={() =>
            setViewport({ scale: Math.max(0.1, viewport.scale * 0.9) })
          }
        >
          -
        </button>
        <div className="w-px h-5 bg-[#333]" />
        <span
          className="text-[12px] text-[#888] w-12 text-center tabular-nums px-1 py-1"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {zoomPercent}%
        </span>
        <div className="w-px h-5 bg-[#333]" />
        <button
          className="text-[#888] hover:text-[#ededed] hover:bg-[#1a1a1a] transition-colors px-2.5 py-1 text-xs"
          onClick={() =>
            setViewport({ scale: Math.min(2, viewport.scale * 1.1) })
          }
        >
          +
        </button>
        <div className="w-px h-5 bg-[#333]" />
        <button
          className="text-[#888] hover:text-[#ededed] hover:bg-[#1a1a1a] transition-colors px-2.5 py-1 text-[11px]"
          onClick={resetViewport}
        >
          Reset
        </button>
        <div className="w-px h-5 bg-[#333]" />
        <button
          className="text-[#888] hover:text-[#ededed] hover:bg-[#1a1a1a] transition-colors px-2.5 py-1 text-[11px]"
          onClick={handleFitAll}
        >
          Fit
        </button>
      </div>
    </div>
  );
}
