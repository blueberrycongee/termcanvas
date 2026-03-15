import { useCallback, useMemo } from "react";
import type { ProjectData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import { WorktreeContainer } from "./WorktreeContainer";
import { useDrag } from "../hooks/useDrag";
import { computeWorktreeSize, PROJ_PAD, PROJ_TITLE_H } from "../layout";
import { useT } from "../i18n/useT";

interface Props {
  project: ProjectData;
}

export function ProjectContainer({ project }: Props) {
  const t = useT();
  const {
    updateProjectPosition,
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

  const computedSize = useMemo(() => {
    if (project.worktrees.length === 0)
      return { w: 340, h: PROJ_TITLE_H + PROJ_PAD + 60 + PROJ_PAD };
    let maxW = 300;
    let totalH = 0;
    for (const wt of project.worktrees) {
      const wtSize = computeWorktreeSize(wt.terminals.length);
      maxW = Math.max(maxW, wt.position.x + wtSize.w);
      totalH = Math.max(totalH, wt.position.y + wtSize.h);
    }
    return {
      w: maxW + PROJ_PAD * 2,
      h: PROJ_TITLE_H + PROJ_PAD + totalH + PROJ_PAD,
    };
  }, [project.worktrees]);

  return (
    <div
      className="absolute panel"
      style={{
        left: project.position.x,
        top: project.position.y,
        width: project.collapsed ? 340 : computedSize.w,
        height: project.collapsed ? undefined : computedSize.h,
        minWidth: 340,
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
          {t.project_label}
        </span>
        <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
          {project.name}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
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
            className="text-[var(--text-faint)] hover:text-[var(--red)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
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
      <div
        className="px-3 pb-3 relative"
        style={{
          height: project.collapsed ? 0 : computedSize.h - PROJ_TITLE_H,
          padding: project.collapsed ? 0 : undefined,
          overflow: "hidden",
        }}
      >
        {project.worktrees.map((worktree) => (
          <WorktreeContainer
            key={worktree.id}
            projectId={project.id}
            worktree={worktree}
          />
        ))}
      </div>
    </div>
  );
}
