import type React from "react";
import { useSessionPanelCollapseStore } from "../stores/sessionPanelCollapseStore";
import { StatusBadges } from "./StatusBadges";
import type {
  ProjectGroup,
  WorktreeGroup,
  CanvasTerminalItem,
} from "./sessionPanelModel";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className="shrink-0 transition-transform duration-150"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
    >
      <path d="M3 2l4 3-4 3z" fill="currentColor" />
    </svg>
  );
}

function WorktreeRow({
  group,
  renderTerminal,
}: {
  group: WorktreeGroup;
  renderTerminal: (item: CanvasTerminalItem) => React.ReactNode;
}) {
  const toggle = useSessionPanelCollapseStore((s) => s.toggle);
  const collapsed = useSessionPanelCollapseStore((s) =>
    s.isCollapsed(group.worktreeId),
  );

  return (
    <div>
      <button
        className="w-full flex items-center gap-1.5 pl-4 pr-2 py-1 text-left cursor-pointer hover:bg-[var(--sidebar-hover)] transition-colors"
        onClick={() => toggle(group.worktreeId)}
      >
        <ChevronIcon open={!collapsed} />
        <span className="text-[10px] text-[var(--text-muted)] truncate flex-1 min-w-0">
          {group.worktreeName}
        </span>
        {collapsed && <StatusBadges summary={group.statusSummary} />}
      </button>
      {!collapsed && (
        <div className="pl-4 pr-2 flex flex-col gap-0.5">
          {group.terminals.map((item) => (
            <div key={item.terminalId}>{renderTerminal(item)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectRow({
  project,
  renderTerminal,
}: {
  project: ProjectGroup;
  renderTerminal: (item: CanvasTerminalItem) => React.ReactNode;
}) {
  const toggle = useSessionPanelCollapseStore((s) => s.toggle);
  const collapsed = useSessionPanelCollapseStore((s) =>
    s.isCollapsed(project.projectId),
  );

  return (
    <div>
      <button
        className="w-full flex items-center gap-1.5 px-3 py-1 text-left cursor-pointer hover:bg-[var(--sidebar-hover)] transition-colors"
        onClick={() => toggle(project.projectId)}
      >
        <ChevronIcon open={!collapsed} />
        <span className="text-[11px] font-medium truncate flex-1 min-w-0">
          {project.projectName}
        </span>
        <StatusBadges summary={project.statusSummary} />
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-0.5">
          {project.flat
            ? project.worktrees[0].terminals.map((item) => (
                <div key={item.terminalId} className="pl-4 pr-2">
                  {renderTerminal(item)}
                </div>
              ))
            : project.worktrees.map((wt) => (
                <WorktreeRow
                  key={wt.worktreeId}
                  group={wt}
                  renderTerminal={renderTerminal}
                />
              ))}
        </div>
      )}
    </div>
  );
}

export function ProjectTree({
  projects,
  renderTerminal,
}: {
  projects: ProjectGroup[];
  renderTerminal: (item: CanvasTerminalItem) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      {projects.map((project) => (
        <ProjectRow
          key={project.projectId}
          project={project}
          renderTerminal={renderTerminal}
        />
      ))}
    </div>
  );
}
