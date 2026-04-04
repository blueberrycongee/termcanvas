import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useProjectStore, createTerminal } from "../stores/projectStore";
import { useDrawingStore } from "../stores/drawingStore";
import { useSelectionStore } from "../stores/selectionStore";
import { useBrowserCardStore } from "../stores/browserCardStore";
import { useNotificationStore } from "../stores/notificationStore";
import {
  addScannedProjectAndFocus,
  ensureTerminalCreationTarget,
} from "../projects/projectCreation";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { useBoxSelect } from "../hooks/useBoxSelect";
import { useViewportCulling } from "../hooks/useViewportCulling";
import { ProjectContainer } from "../containers/ProjectContainer";
import { BrowserCard } from "../components/BrowserCard";
import { DrawingLayer } from "./DrawingLayer";

import { FamilyTreeOverlay } from "../components/FamilyTreeOverlay";
import { BoxSelectOverlay } from "./BoxSelectOverlay";
import { useT } from "../i18n/useT";
import { panToTerminal } from "../utils/panToTerminal";

export function Canvas() {
  const t = useT();
  const { viewport, isAnimating, leftPanelCollapsed, leftPanelWidth } = useCanvasStore();
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const file = files[0];
    const dirPath = window.termcanvas.fs.getFilePath(file);
    if (!dirPath) return;

    const { notify } = useNotificationStore.getState();

    let info: Awaited<ReturnType<typeof window.termcanvas.project.scan>>;
    try {
      info = await window.termcanvas.project.scan(dirPath);
    } catch (err) {
      notify("error", t.error_scan(err));
      return;
    }
    if (!info) {
      notify("error", t.error_scan("Failed to scan directory"));
      return;
    }

    addScannedProjectAndFocus(info);
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
      notify("error", t.error_scan("Failed to scan directory"));
      return;
    }

    addScannedProjectAndFocus(info);
  };

  const handleNewTerminal = () => {
    const homePath = window.termcanvas?.app.homePath;
    if (!homePath) return;

    const target = ensureTerminalCreationTarget(homePath);
    if (!target) return;

    const terminal = createTerminal("shell");
    const { addTerminal, setFocusedTerminal } = useProjectStore.getState();
    addTerminal(target.projectId, target.worktreeId, terminal);
    setFocusedTerminal(terminal.id);
    panToTerminal(terminal.id);
  };

  const leftOffset = leftPanelCollapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth;

  return (
    <div
      className={`fixed overflow-hidden canvas-bg ${isDrawing ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
      style={{
        left: leftOffset,
        top: 0,
        right: 0,
        bottom: 0,
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
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
          willChange: isAnimating ? "transform" : undefined,
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

      <BoxSelectOverlay />

      {/* Drawing overlay - outside transform div, uses its own <g> transform */}
      {usePreferencesStore((s) => s.drawingEnabled) && <DrawingLayer />}

      {projects.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center pointer-events-auto">
            <div className="text-[var(--text-muted)] text-lg font-light mb-4">
              {t.canvas_empty_title}
            </div>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleNewTerminal}
                className="px-6 py-3 bg-[var(--accent)] hover:brightness-110 text-white rounded-lg transition-all"
              >
                {t.shortcut_new_terminal}
              </button>
              <button
                onClick={handleAddProject}
                className="px-6 py-3 bg-[var(--button-bg)] hover:bg-[var(--button-bg-hover)] text-[var(--button-text)] rounded-lg transition-colors"
              >
                {t.canvas_empty_action}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
