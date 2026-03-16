import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useDrawingStore } from "../stores/drawingStore";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { ProjectContainer } from "../containers/ProjectContainer";
import { DrawingLayer } from "./DrawingLayer";

export function Canvas() {
  const { viewport, isAnimating } = useCanvasStore();
  const { projects } = useProjectStore();
  const { tool } = useDrawingStore();
  const { handleWheel, handleMouseDown } = useCanvasInteraction();
  const isDrawing = tool !== "select";

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
        }
      }}
    >
      <div
        id="canvas-layer"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          transformOrigin: "0 0",
          willChange: "transform",
          filter: isAnimating ? "blur(1.5px)" : "none",
          transition: "filter 0.15s ease",
        }}
      >
        {projects.map((project) => (
          <ProjectContainer key={project.id} project={project} />
        ))}
      </div>

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
