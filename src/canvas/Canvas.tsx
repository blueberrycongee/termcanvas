import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { ProjectContainer } from "../containers/ProjectContainer";

export function Canvas() {
  const { viewport } = useCanvasStore();
  const { projects } = useProjectStore();
  const { handleWheel, handleMouseDown, handleMouseMove, handleMouseUp } =
    useCanvasInteraction();

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-zinc-950"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {projects.map((project) => (
          <ProjectContainer key={project.id} project={project} />
        ))}
      </div>
    </div>
  );
}
