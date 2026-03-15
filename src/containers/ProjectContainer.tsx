import { useCallback, useRef, useMemo } from "react";
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

  const childMinW = useMemo(() => {
    if (project.worktrees.length === 0) return 340;
    const maxWtW = Math.max(...project.worktrees.map((wt) => wt.size.w || 300));
    return Math.max(340, maxWtW + 24 + 2);
  }, [project.worktrees]);

  const childMinH = useMemo(() => {
    if (project.worktrees.length === 0) return 120;
    const totalH = project.worktrees.reduce(
      (sum, wt) => sum + (wt.size.h || 200),
      0,
    );
    const gaps = (project.worktrees.length - 1) * 8;
    return Math.max(120, totalH + gaps + 24 + 36 + 2);
  }, [project.worktrees]);

  const handleResize = useResize(
    project.size.w,
    project.size.h,
    useCallback(
      (w: number, h: number) => {
        if (containerRef.current) {
          w = Math.max(w, containerRef.current.scrollWidth);
          h = Math.max(h, containerRef.current.scrollHeight);
        }
        updateProjectSize(project.id, w, h);
      },
      [project.id, updateProjectSize],
    ),
    childMinW,
    childMinH,
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
        className="flex items-center gap-2 px-4 py-2 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleDrag}
        onDoubleClick={() => toggleProjectCollapse(project.id)}
      >
        <span
          className="text-[11px] font-medium text-[#0070f3]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          Project
        </span>
        <span className="text-[13px] font-medium text-[#ededed] truncate">
          {project.name}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="text-[#444] hover:text-[#ededed] transition-colors duration-150 p-1 rounded-md hover:bg-[#222]"
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
              className={`transition-transform duration-150 ${project.collapsed ? "-rotate-90" : ""}`}
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
            className="text-[#333] hover:text-[#ee0000] transition-colors duration-150 p-1 rounded-md hover:bg-[#222]"
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
        <div className="px-3 pb-3 flex flex-col gap-2">
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
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize opacity-0 hover:opacity-100 transition-opacity duration-150"
        onMouseDown={handleResize}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" className="text-[#333]">
          <path
            d="M14 14L8 14M14 14L14 8"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
