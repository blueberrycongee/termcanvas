import { useCanvasStore } from "../stores/canvasStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useProjectStore } from "../stores/projectStore";
import { useDrawingStore } from "../stores/drawingStore";
import { useSelectionStore } from "../stores/selectionStore";
import { useBrowserCardStore } from "../stores/browserCardStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { useBoxSelect } from "../hooks/useBoxSelect";
import { useViewportCulling } from "../hooks/useViewportCulling";
import { ProjectContainer } from "../containers/ProjectContainer";
import { BrowserCard } from "../components/BrowserCard";
import { DrawingLayer } from "./DrawingLayer";
import { getProjectBounds } from "../utils/projectBounds";
import { generateId } from "../utils/id";

import { FamilyTreeOverlay } from "../components/FamilyTreeOverlay";
import { BoxSelectOverlay } from "./BoxSelectOverlay";
import { useT } from "../i18n/useT";

export function Canvas() {
  const t = useT();
  const { viewport, isAnimating } = useCanvasStore();
  const animationBlur = usePreferencesStore((s) => s.animationBlur);
  const { projects } = useProjectStore();
  const { tool } = useDrawingStore();
  const browserCards = useBrowserCardStore((s) => s.cards);
  const { handleWheel, handleMouseDown: handlePanMouseDown } = useCanvasInteraction();
  const { handleMouseDown: handleBoxSelectMouseDown } = useBoxSelect();
  const visibleProjectIds = useViewportCulling(projects);
  const isDrawing = tool !== "select";

  const handleMouseDown = (e: React.MouseEvent) => {
    handleBoxSelectMouseDown(e);
    handlePanMouseDown(e);
  };

  const handleAddProject = async () => {
    if (!window.termcanvas) return;
    const { notify } = useNotificationStore.getState();

    let dirPath: string | null;
    try {
      dirPath = await window.termcanvas.project.selectDirectory();
    } catch (err) {
      notify("error", t.error_dir_picker(err));
      return;
    }
    if (!dirPath) return;

    let info: Awaited<ReturnType<typeof window.termcanvas.project.scan>>;
    try {
      info = await window.termcanvas.project.scan(dirPath);
    } catch (err) {
      notify("error", t.error_scan(err));
      return;
    }
    if (!info) {
      notify("warn", t.error_not_git(dirPath));
      return;
    }

    const { projects, addProject } = useProjectStore.getState();
    let placeX = 0;
    const gap = 80;
    for (const p of projects) {
      const bounds = getProjectBounds(p);
      placeX = Math.max(placeX, bounds.x + bounds.w + gap);
    }

    addProject({
      id: generateId(),
      name: info.name,
      path: info.path,
      position: { x: placeX, y: 0 },
      collapsed: false,
      zIndex: 0,
      worktrees: info.worktrees.map((wt, i) => ({
        id: generateId(),
        name: wt.branch,
        path: wt.path,
        position: { x: 0, y: i * 360 },
        collapsed: false,
        terminals: [],
      })),
    });
  };

  return (
    <div
      className={`fixed inset-0 overflow-hidden canvas-bg ${isDrawing ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (
          target === e.currentTarget ||
          target.id === "canvas-layer"
        ) {
          useProjectStore.getState().clearFocus();
          useSelectionStore.getState().clearSelection();
        }
      }}
    >
      <div
        id="canvas-layer"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          transformOrigin: "0 0",
          willChange: "transform",
          filter: animationBlur > 0 && isAnimating ? `blur(${animationBlur}px)` : "none",
          transition: animationBlur > 0 ? "filter 0.15s ease" : "none",
        }}
      >
        {projects.map((project) => (
          <div
            key={project.id}
            style={{
              contentVisibility: visibleProjectIds.has(project.id) ? "visible" : "hidden",
            }}
          >
            <ProjectContainer project={project} />
          </div>
        ))}
        {Object.values(browserCards).map((card) => (
          <BrowserCard key={card.id} card={card} />
        ))}
        <FamilyTreeOverlay />
      </div>

      {/* Box-select overlay */}
      <BoxSelectOverlay />

      {/* Drawing overlay - outside transform div, uses its own <g> transform */}
      {usePreferencesStore((s) => s.drawingEnabled) && <DrawingLayer />}

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center pointer-events-auto">
            <div className="text-[var(--text-muted)] text-lg font-light mb-4">
              {t.canvas_empty_title}
            </div>
            <button
              onClick={handleAddProject}
              className="px-6 py-3 bg-[var(--button-bg)] hover:bg-[var(--button-bg-hover)] text-[var(--button-text)] rounded-lg transition-colors"
            >
              {t.canvas_empty_action}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
