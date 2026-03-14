import { useCallback } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore, generateId } from "../stores/projectStore";

export function Toolbar() {
  const { viewport, setViewport, resetViewport } = useCanvasStore();
  const { addProject } = useProjectStore();

  const handleAddProject = useCallback(async () => {
    const dirPath = await window.termcanvas.project.selectDirectory();
    if (!dirPath) return;

    const info = await window.termcanvas.project.scan(dirPath);
    if (!info) {
      alert("Not a git repository");
      return;
    }

    addProject({
      id: generateId(),
      name: info.name,
      path: info.path,
      position: { x: 100 - viewport.x, y: 100 - viewport.y },
      collapsed: false,
      worktrees: info.worktrees.map((wt) => ({
        id: generateId(),
        name: wt.branch,
        path: wt.path,
        position: { x: 0, y: 0 },
        collapsed: false,
        terminals: [],
      })),
    });
  }, [addProject, viewport]);

  return (
    <div className="fixed top-0 left-0 right-0 h-10 bg-zinc-900/90 backdrop-blur border-b border-zinc-800 flex items-center px-3 gap-3 z-50">
      <span className="text-sm font-semibold text-zinc-300">TermCanvas</span>

      <div className="h-4 w-px bg-zinc-700" />

      <button
        className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        onClick={handleAddProject}
      >
        + Add Project
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button
          className="text-xs text-zinc-500 hover:text-zinc-300 px-1"
          onClick={() => setViewport({ scale: viewport.scale * 0.9 })}
        >
          −
        </button>
        <span className="text-xs text-zinc-500 w-12 text-center">
          {Math.round(viewport.scale * 100)}%
        </span>
        <button
          className="text-xs text-zinc-500 hover:text-zinc-300 px-1"
          onClick={() => setViewport({ scale: viewport.scale * 1.1 })}
        >
          +
        </button>
        <button
          className="text-xs text-zinc-500 hover:text-zinc-300 px-2"
          onClick={resetViewport}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
