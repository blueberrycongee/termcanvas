import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSessionPanelCollapseStore } from "../stores/sessionPanelCollapseStore";
import { useProjectStore } from "../stores/projectStore";
import { useNotificationStore } from "../stores/notificationStore";
import { ContextMenu } from "./ContextMenu";
import { createTerminalInScene } from "../actions/terminalSceneActions";
import { StatusBadges } from "./StatusBadges";
import type {
  ProjectGroup,
  WorktreeGroup,
  CanvasTerminalItem,
} from "./sessionPanelModel";

function PlusIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      className="shrink-0"
    >
      <path
        d="M6 2V10M2 6H10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

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

function NewWorktreeInput({
  projectPath,
  onDone,
}: {
  projectPath: string;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const branch = value.trim();
    if (!branch || busy) {
      if (!branch) onDone();
      return;
    }
    setBusy(true);
    try {
      const result = await window.termcanvas.project.createWorktree(
        projectPath,
        branch,
      );
      if (result.ok) {
        useProjectStore.getState().syncWorktrees(projectPath, result.worktrees);
        useNotificationStore
          .getState()
          .notify("info", `Worktree "${branch}" created`);
        onDone();
      } else {
        useNotificationStore
          .getState()
          .notify("error", `Failed to create worktree: ${result.error}`);
        setBusy(false);
      }
    } catch (err) {
      useNotificationStore
        .getState()
        .notify(
          "error",
          `Failed to create worktree: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      setBusy(false);
    }
  };

  return (
    <div className="pl-6 pr-2 py-1">
      <input
        ref={inputRef}
        value={value}
        disabled={busy}
        placeholder="branch name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        onBlur={() => {
          if (!busy) onDone();
        }}
        className="w-full text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--accent)] text-[var(--text-primary)] outline-none disabled:opacity-50"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      />
    </div>
  );
}

function WorktreeRow({
  group,
  projectPath,
  renderTerminal,
}: {
  group: WorktreeGroup;
  projectPath: string;
  renderTerminal: (item: CanvasTerminalItem) => React.ReactNode;
}) {
  const toggle = useSessionPanelCollapseStore((s) => s.toggle);
  const collapsed = useSessionPanelCollapseStore((s) =>
    s.isCollapsed(group.worktreeId),
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const handleNewTerminal = (type: "shell" | "claude" | "codex") => {
    const projects = useProjectStore.getState().projects;
    const project = projects.find((p) =>
      p.worktrees.some((w) => w.id === group.worktreeId),
    );
    if (!project) return;
    createTerminalInScene({
      projectId: project.id,
      worktreeId: group.worktreeId,
      type,
    });
  };

  const handleRemove = async () => {
    if (group.isMain) return;
    const runningCount = group.terminals.length;
    const warning =
      runningCount > 0
        ? `This worktree has ${runningCount} terminal${runningCount === 1 ? "" : "s"}. Remove anyway?`
        : `Remove worktree "${group.worktreeName}"?`;
    if (!window.confirm(warning)) return;

    try {
      const result = await window.termcanvas.project.removeWorktree(
        projectPath,
        group.worktreePath,
      );
      if (result.ok) {
        useProjectStore.getState().syncWorktrees(projectPath, result.worktrees);
        useNotificationStore
          .getState()
          .notify("info", `Worktree "${group.worktreeName}" removed`);
      } else {
        useNotificationStore
          .getState()
          .notify("error", `Failed to remove worktree: ${result.error}`);
      }
    } catch (err) {
      useNotificationStore
        .getState()
        .notify(
          "error",
          `Failed to remove worktree: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
    }
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className="group w-full flex items-center gap-1.5 pl-4 pr-1 py-1 text-left cursor-pointer hover:bg-[var(--sidebar-hover)] transition-colors"
        onClick={() => toggle(group.worktreeId)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle(group.worktreeId);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <ChevronIcon open={!collapsed} />
        <span className="text-[10px] text-[var(--text-muted)] truncate flex-1 min-w-0">
          {group.worktreeName}
        </span>
        {collapsed && <StatusBadges summary={group.statusSummary} />}
        <button
          type="button"
          title="New shell terminal"
          aria-label="New shell terminal"
          onClick={(e) => {
            e.stopPropagation();
            handleNewTerminal("shell");
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]"
        >
          <PlusIcon />
        </button>
      </div>
      {!collapsed && (
        <div className="pl-4 pr-2 flex flex-col gap-0.5">
          {group.terminals.map((item) => (
            <div key={item.terminalId}>{renderTerminal(item)}</div>
          ))}
        </div>
      )}
      {menu &&
        createPortal(
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={[
              {
                label: "New Terminal (Shell)",
                onClick: () => handleNewTerminal("shell"),
              },
              {
                label: "New Terminal (Claude)",
                onClick: () => handleNewTerminal("claude"),
              },
              {
                label: "New Terminal (Codex)",
                onClick: () => handleNewTerminal("codex"),
              },
              ...(group.isMain
                ? []
                : [
                    { type: "separator" as const },
                    {
                      label: "Remove Worktree",
                      danger: true,
                      onClick: () => void handleRemove(),
                    },
                  ]),
            ]}
            onClose={() => setMenu(null)}
          />,
          document.body,
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [creating, setCreating] = useState(false);

  const handleNewTerminal = () => {
    const projects = useProjectStore.getState().projects;
    const liveProject = projects.find((p) => p.id === project.projectId);
    const firstWorktree = liveProject?.worktrees[0];
    if (!liveProject || !firstWorktree) return;
    createTerminalInScene({
      projectId: liveProject.id,
      worktreeId: firstWorktree.id,
      type: "shell",
    });
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className="group w-full flex items-center gap-1.5 px-3 py-1 text-left cursor-pointer hover:bg-[var(--sidebar-hover)] transition-colors"
        onClick={() => toggle(project.projectId)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle(project.projectId);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <ChevronIcon open={!collapsed} />
        <span className="text-[11px] font-medium truncate flex-1 min-w-0">
          {project.projectName}
        </span>
        <StatusBadges summary={project.statusSummary} />
        <button
          type="button"
          title="New shell terminal"
          aria-label="New shell terminal"
          onClick={(e) => {
            e.stopPropagation();
            handleNewTerminal();
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]"
        >
          <PlusIcon />
        </button>
      </div>
      {!collapsed && creating && (
        <NewWorktreeInput
          projectPath={project.projectPath}
          onDone={() => setCreating(false)}
        />
      )}
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
                  projectPath={project.projectPath}
                  renderTerminal={renderTerminal}
                />
              ))}
        </div>
      )}
      {menu &&
        createPortal(
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={[
              {
                label: "New Terminal",
                onClick: handleNewTerminal,
              },
              {
                label: "New Worktree...",
                onClick: () => {
                  const store = useSessionPanelCollapseStore.getState();
                  if (store.isCollapsed(project.projectId)) {
                    store.toggle(project.projectId);
                  }
                  setCreating(true);
                },
              },
            ]}
            onClose={() => setMenu(null)}
          />,
          document.body,
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
