import { useCanvasStore } from "../stores/canvasStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useProjectStore } from "../stores/projectStore";
import { useDrawingStore } from "../stores/drawingStore";
import { useSelectionStore } from "../stores/selectionStore";
import { useBrowserCardStore } from "../stores/browserCardStore";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { useBoxSelect } from "../hooks/useBoxSelect";
import { useViewportCulling } from "../hooks/useViewportCulling";
import { ProjectContainer } from "../containers/ProjectContainer";
import { BrowserCard } from "../components/BrowserCard";
import { DrawingLayer } from "./DrawingLayer";
import { ConnectionOverlay } from "./ConnectionOverlay";
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
        <ConnectionOverlay />
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
          <div className="text-center">
            <div className="text-[var(--text-muted)] text-lg font-light mb-2">
              {t.canvas_empty_title}
            </div>
            <div className="text-[var(--text-faint)] text-sm">
              {t.canvas_empty_click}{" "}
              <span className="text-[var(--text-secondary)]">{t.canvas_empty_action}</span>{" "}
              {t.canvas_empty_suffix}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
