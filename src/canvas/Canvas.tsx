import { useCanvasStore } from "../stores/canvasStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useProjectStore } from "../stores/projectStore";
import { useDrawingStore } from "../stores/drawingStore";
import { useSelectionStore } from "../stores/selectionStore";
import { useBrowserCardStore } from "../stores/browserCardStore";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { useBoxSelect } from "../hooks/useBoxSelect";
import { ProjectContainer } from "../containers/ProjectContainer";
import { BrowserCard } from "../components/BrowserCard";
import { DrawingLayer } from "./DrawingLayer";
import { ConnectionOverlay } from "./ConnectionOverlay";
import { FamilyTreeOverlay } from "../components/FamilyTreeOverlay";
import { BoxSelectOverlay } from "./BoxSelectOverlay";

export function Canvas() {
  const { viewport, isAnimating } = useCanvasStore();
  const animationBlur = usePreferencesStore((s) => s.animationBlur);
  const { projects } = useProjectStore();
  const { tool } = useDrawingStore();
  const browserCards = useBrowserCardStore((s) => s.cards);
  const { handleWheel, handleMouseDown: handlePanMouseDown } = useCanvasInteraction();
  const { handleMouseDown: handleBoxSelectMouseDown } = useBoxSelect();
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
        <ConnectionOverlay />
        {projects.map((project) => (
          <ProjectContainer key={project.id} project={project} />
        ))}
        {Object.values(browserCards).map((card) => (
          <BrowserCard key={card.id} card={card} />
        ))}
        <FamilyTreeOverlay />
      </div>

      {/* Box-select overlay */}
      <BoxSelectOverlay />

      {/* Drawing overlay - outside transform div, uses its own <g> transform */}
      <DrawingLayer />

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-[var(--text-muted)] text-lg font-light mb-2">
              No projects yet
            </div>
            <div className="text-[var(--text-faint)] text-sm">
              Click{" "}
              <span className="text-[var(--text-secondary)]">Add Project</span>{" "}
              in the toolbar to get started
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
