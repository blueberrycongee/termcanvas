import { useCallback, useRef } from "react";
import type { ProjectData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import { WorktreeContainer } from "./WorktreeContainer";

interface Props {
  project: ProjectData;
}

export function ProjectContainer({ project }: Props) {
  const { updateProjectPosition, toggleProjectCollapse } = useProjectStore();
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: project.position.x,
        origY: project.position.y,
      };

      const handleMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = moveEvent.clientX - dragRef.current.startX;
        const dy = moveEvent.clientY - dragRef.current.startY;
        updateProjectPosition(
          project.id,
          dragRef.current.origX + dx,
          dragRef.current.origY + dy,
        );
      };

      const handleUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [project.id, project.position, updateProjectPosition],
  );

  return (
    <div
      className="absolute rounded-xl border border-zinc-700 bg-zinc-900/80 backdrop-blur-sm min-w-[200px]"
      style={{
        left: project.position.x,
        top: project.position.y,
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing select-none border-b border-zinc-700"
        onMouseDown={handleMouseDown}
        onDoubleClick={() => toggleProjectCollapse(project.id)}
      >
        <span className="text-xs font-mono text-blue-400">PROJECT</span>
        <span className="text-sm font-medium text-zinc-200 truncate">
          {project.name}
        </span>
        <button
          className="ml-auto text-zinc-500 hover:text-zinc-300 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            toggleProjectCollapse(project.id);
          }}
        >
          {project.collapsed ? "▸" : "▾"}
        </button>
      </div>

      {/* Worktrees */}
      {!project.collapsed && (
        <div className="p-3 flex flex-wrap gap-3">
          {project.worktrees.map((worktree) => (
            <WorktreeContainer
              key={worktree.id}
              projectId={project.id}
              worktree={worktree}
            />
          ))}
        </div>
      )}
    </div>
  );
}
