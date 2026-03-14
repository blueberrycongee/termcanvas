import { useCallback, useRef } from "react";
import type { ProjectData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import { WorktreeContainer } from "./WorktreeContainer";
import { useDrag } from "../hooks/useDrag";
import { useResize } from "../hooks/useResize";

interface Props {
  project: ProjectData;
}

export function ProjectContainer({ project }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    updateProjectPosition,
    updateProjectSize,
    toggleProjectCollapse,
    removeProject,
    bringToFront,
  } = useProjectStore();

  const handleDrag = useDrag(
    project.position.x,
    project.position.y,
    useCallback(
      (x: number, y: number) => updateProjectPosition(project.id, x, y),
      [project.id, updateProjectPosition],
    ),
  );

  const handleResize = useResize(
    project.size.w,
    project.size.h,
    useCallback(
      (w: number, h: number) => updateProjectSize(project.id, w, h),
      [project.id, updateProjectSize],
    ),
    340,
    120,
    containerRef,
  );

  return (
    <div
      ref={containerRef}
      className="absolute panel"
      style={{
        left: project.position.x,
        top: project.position.y,
        width: project.size.w > 0 ? project.size.w : undefined,
        minWidth: 340,
        height: project.size.h > 0 ? project.size.h : undefined,
        zIndex: project.zIndex ?? 0,
      }}
      onMouseDown={() => bringToFront(project.id)}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2.5 px-4 py-2.5 cursor-grab active:cursor-grabbing select-none border-b border-[#333]"
        onMouseDown={handleDrag}
        onDoubleClick={() => toggleProjectCollapse(project.id)}
      >
        <span className="type-badge bg-[#1a1a1a] text-[#0070f3]">Project</span>
        <span className="text-[13px] font-medium text-[#ededed] truncate">
          {project.name}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="text-[#666] hover:text-[#ededed] transition-colors p-1 rounded hover:bg-[#1a1a1a]"
            onClick={(e) => {
              e.stopPropagation();
              toggleProjectCollapse(project.id);
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              className={`transition-transform ${project.collapsed ? "-rotate-90" : ""}`}
            >
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            className="text-[#444] hover:text-[#ee0000] transition-colors p-1 rounded hover:bg-[#1a1a1a]"
            onClick={(e) => {
              e.stopPropagation();
              removeProject(project.id);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 3L9 9M9 3L3 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Worktrees */}
      {!project.collapsed && (
        <div className="p-3 flex flex-col gap-3 overflow-auto">
          {project.worktrees.map((worktree) => (
            <WorktreeContainer
              key={worktree.id}
              projectId={project.id}
              worktree={worktree}
            />
          ))}
        </div>
      )}

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize opacity-0 hover:opacity-100 transition-opacity"
        onMouseDown={handleResize}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" className="text-[#444]">
          <path
            d="M14 14L8 14M14 14L14 8M14 14L6 6"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
