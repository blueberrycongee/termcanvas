import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { ProjectContainer } from "../containers/ProjectContainer";

export function Canvas() {
  const { viewport } = useCanvasStore();
  const { projects } = useProjectStore();
  const { handleWheel, handleMouseDown } = useCanvasInteraction();

  return (
    <div
      className="fixed inset-0 overflow-hidden canvas-bg cursor-grab active:cursor-grabbing"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
    >
      <div
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          transformOrigin: "0 0",
          willChange: "transform",
        }}
      >
        {projects.map((project) => (
          <ProjectContainer key={project.id} project={project} />
        ))}
      </div>

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-[#444] text-lg font-light mb-2">
              No projects yet
            </div>
            <div className="text-[#333] text-sm">
              Click <span className="text-[#666]">Add Project</span> in the
              toolbar to get started
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
