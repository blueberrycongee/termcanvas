import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSessionPanelCollapseStore } from "../stores/sessionPanelCollapseStore";
import { useProjectStore } from "../stores/projectStore";
import { useNotificationStore } from "../stores/notificationStore";
import { ContextMenu } from "./ContextMenu";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { IconButton } from "./ui/IconButton";
import { createTerminalInScene } from "../actions/terminalSceneActions";
import { activateWorktreeInScene } from "../actions/sceneSelectionActions";
import { StatusBadges } from "./StatusBadges";
import { useT } from "../i18n/useT";
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

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path
        d="M2 2L8 8M8 2L2 8"
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
  const t = useT();
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
          .notify("info", t.panel_worktree_created(branch));
        onDone();
      } else {
        useNotificationStore
          .getState()
          .notify("error", t.panel_worktree_create_failed(result.error));
        setBusy(false);
      }
    } catch (err) {
      useNotificationStore
        .getState()
        .notify(
          "error",
          t.panel_worktree_create_failed(
            err instanceof Error ? err.message : String(err),
          ),
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
        placeholder={t.panel_branch_name_placeholder}
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
  const t = useT();
  const toggle = useSessionPanelCollapseStore((s) => s.toggle);
  const collapsed = useSessionPanelCollapseStore((s) =>
    s.isCollapsed(group.worktreeId),
  );

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

  // Activate the worktree so subsequent actions like cmd+t (which reads
  // focusedProjectId/focusedWorktreeId from projectStore) target this
  // worktree.
  const handleActivate = () => {
    const projects = useProjectStore.getState().projects;
    const project = projects.find((p) =>
      p.worktrees.some((w) => w.id === group.worktreeId),
    );
    if (!project) return;
    activateWorktreeInScene(project.id, group.worktreeId);
  };

  // Two-stage remove flow (P8):
  //   stage="soft"  → first confirmation, calls remove without --force
  //   stage="force" → only reached if git refused because of dirty files;
  //                   second confirmation explicitly names what will be lost
  //                   before calling remove with --force
  // null = no dialog open.
  const [removeStage, setRemoveStage] = useState<"soft" | "force" | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const openRemoveDialog = () => {
    if (group.isMain) return;
    setRemoveStage("soft");
  };

  const closeRemoveDialog = () => {
    if (removeBusy) return;
    setRemoveStage(null);
  };

  const performRemove = async (force: boolean) => {
    setRemoveBusy(true);
    try {
      const result = await window.termcanvas.project.removeWorktree(
        projectPath,
        group.worktreePath,
        force,
      );
      if (result.ok) {
        useProjectStore.getState().syncWorktrees(projectPath, result.worktrees);
        useNotificationStore
          .getState()
          .notify("info", t.panel_worktree_removed(group.worktreeName));
        setRemoveStage(null);
        return;
      }
      // Soft remove failed — if git refused because the worktree is dirty,
      // escalate to the force-confirmation dialog so the user gets a real
      // chance to opt in. Any other failure mode bubbles to the toast.
      const dirty = /contains modified or untracked files/i.test(result.error);
      if (!force && dirty) {
        setRemoveStage("force");
        return;
      }
      useNotificationStore
        .getState()
        .notify("error", t.panel_worktree_remove_failed(result.error));
      setRemoveStage(null);
    } catch (err) {
      useNotificationStore
        .getState()
        .notify(
          "error",
          t.panel_worktree_remove_failed(
            err instanceof Error ? err.message : String(err),
          ),
        );
      setRemoveStage(null);
    } finally {
      setRemoveBusy(false);
    }
  };

  const removeDialogTitle =
    removeStage === "force"
      ? t.panel_worktree_force_remove_title
      : t.panel_worktree_remove_title;
  const removeDialogBody =
    removeStage === "force"
      ? t.panel_worktree_force_remove_body(group.worktreeName)
      : group.terminals.length > 0
        ? t.panel_worktree_remove_confirm_with_terminals(
            group.worktreeName,
            group.terminals.length,
          )
        : t.panel_worktree_remove_confirm(group.worktreeName);
  const removeDialogConfirmLabel =
    removeStage === "force"
      ? t.panel_worktree_force_remove_button
      : t.panel_worktree_remove_button;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className="group w-full flex items-center gap-1.5 pl-4 pr-1 py-1 text-left cursor-pointer hover:bg-[var(--sidebar-hover)] transition-colors"
        onClick={() => {
          // Left-click on the row both activates and toggles expand/collapse
          // so users don't have to aim for the tiny chevron. Right-click is
          // handled separately in onContextMenu and must NOT toggle — see
          // below.
          handleActivate();
          toggle(group.worktreeId);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleActivate();
          }
        }}
        onContextMenu={() => {
          // Right-click should still focus the row even though the worktree
          // context menu was removed in favor of the hover X button — so a
          // subsequent cmd+t targets the row the user just right-clicked.
          // Intentionally does NOT toggle collapse: right-click is a focus
          // gesture, not an expand gesture. React's onClick does not fire on
          // right-click, so the onClick above stays out of the way here.
          handleActivate();
        }}
      >
        <button
          type="button"
          aria-label={collapsed ? "Expand" : "Collapse"}
          aria-expanded={!collapsed}
          className="shrink-0 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] rounded"
          onClick={(e) => {
            e.stopPropagation();
            toggle(group.worktreeId);
          }}
        >
          <ChevronIcon open={!collapsed} />
        </button>
        <span className="text-[10px] text-[var(--text-muted)] truncate flex-1 min-w-0">
          {group.worktreeName}
        </span>
        {collapsed && <StatusBadges summary={group.statusSummary} />}
        <IconButton
          size="sm"
          tone="neutral"
          label={t.panel_new_terminal_shell}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            handleNewTerminal("shell");
          }}
        >
          <PlusIcon />
        </IconButton>
        {!group.isMain && (
          <IconButton
            size="sm"
            tone="danger"
            label={t.panel_remove_worktree}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              openRemoveDialog();
            }}
          >
            <CloseIcon />
          </IconButton>
        )}
      </div>
      {!collapsed && (
        <div className="pl-4 pr-2 flex flex-col gap-0.5">
          {group.terminals.map((item) => (
            <div key={item.terminalId}>{renderTerminal(item)}</div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={removeStage !== null}
        title={removeDialogTitle}
        body={removeDialogBody}
        confirmLabel={removeDialogConfirmLabel}
        busyLabel={t.panel_worktree_force_remove_busy}
        confirmTone="danger"
        busy={removeBusy}
        onCancel={closeRemoveDialog}
        onConfirm={() => {
          void performRemove(removeStage === "force");
        }}
      />
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
  const t = useT();
  const toggle = useSessionPanelCollapseStore((s) => s.toggle);
  const collapsed = useSessionPanelCollapseStore((s) =>
    s.isCollapsed(project.projectId),
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);

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

  // Activate the project's first worktree so cmd+t targets it.
  const handleActivate = () => {
    const projects = useProjectStore.getState().projects;
    const liveProject = projects.find((p) => p.id === project.projectId);
    const firstWorktree = liveProject?.worktrees[0];
    if (!liveProject || !firstWorktree) return;
    activateWorktreeInScene(liveProject.id, firstWorktree.id);
  };

  const terminalCount = project.worktrees.reduce(
    (acc, wt) => acc + wt.terminals.length,
    0,
  );
  const removeProjectBody =
    terminalCount > 0
      ? t.panel_project_remove_confirm_with_terminals(
          project.projectName,
          terminalCount,
        )
      : t.panel_project_remove_confirm(project.projectName);

  const openRemoveProject = () => {
    setConfirmingRemove(true);
  };

  const performRemoveProject = () => {
    useProjectStore.getState().removeProject(project.projectId);
    useNotificationStore
      .getState()
      .notify("info", t.panel_project_removed(project.projectName));
    setConfirmingRemove(false);
  };

  const openDeleteFromDisk = () => {
    setDeleteInput("");
    setConfirmingDelete(true);
  };

  const performDeleteFromDisk = async () => {
    if (deleting) return;
    if (deleteInput !== project.projectName) return;
    setDeleting(true);
    try {
      const result = await window.termcanvas.project.deleteFolder(
        project.projectPath,
      );
      if (result.ok) {
        useProjectStore.getState().removeProject(project.projectId);
        useNotificationStore
          .getState()
          .notify("info", t.panel_project_deleted(project.projectName));
        setConfirmingDelete(false);
      } else {
        useNotificationStore
          .getState()
          .notify("error", t.panel_project_delete_failed(result.error));
      }
    } catch (err) {
      useNotificationStore
        .getState()
        .notify(
          "error",
          t.panel_project_delete_failed(
            err instanceof Error ? err.message : String(err),
          ),
        );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className="group w-full flex items-center gap-1.5 px-3 py-1 text-left cursor-pointer hover:bg-[var(--sidebar-hover)] transition-colors"
        onClick={() => {
          // Match worktree rows: clicking anywhere on the project row should
          // both focus it and toggle collapse, instead of forcing the user to
          // aim for the small chevron.
          handleActivate();
          toggle(project.projectId);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleActivate();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Focus this project before the menu opens, matching macOS Finder /
          // VS Code semantics — otherwise cmd+t after dismissing the menu
          // targets whichever row was previously active.
          handleActivate();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <button
          type="button"
          aria-label={collapsed ? "Expand" : "Collapse"}
          aria-expanded={!collapsed}
          className="shrink-0 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] rounded"
          onClick={(e) => {
            e.stopPropagation();
            toggle(project.projectId);
          }}
        >
          <ChevronIcon open={!collapsed} />
        </button>
        <span className="text-[11px] font-medium truncate flex-1 min-w-0">
          {project.projectName}
        </span>
        <StatusBadges summary={project.statusSummary} />
        <IconButton
          size="sm"
          tone="neutral"
          label={t.panel_new_terminal}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            handleNewTerminal();
          }}
        >
          <PlusIcon />
        </IconButton>
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
                label: t.panel_new_terminal,
                onClick: handleNewTerminal,
              },
              {
                label: t.panel_new_worktree,
                onClick: () => {
                  const store = useSessionPanelCollapseStore.getState();
                  if (store.isCollapsed(project.projectId)) {
                    store.toggle(project.projectId);
                  }
                  setCreating(true);
                },
              },
              { type: "separator" as const },
              {
                label: t.panel_remove_project,
                danger: true,
                onClick: openRemoveProject,
              },
              {
                label: t.panel_delete_project_disk,
                danger: true,
                onClick: openDeleteFromDisk,
              },
            ]}
            onClose={() => setMenu(null)}
          />,
          document.body,
        )}
      <ConfirmDialog
        open={confirmingDelete}
        title={t.panel_project_delete_title}
        body={
          <>
            {t.panel_project_delete_intro}
            <div className="mt-1 font-mono text-[10px] break-all text-[var(--text-primary)]">
              {project.projectPath}
            </div>
            <div className="mt-2">{t.panel_project_delete_warning}</div>
            <div className="mt-2">
              {t.panel_project_delete_type_to_confirm}{" "}
              <span className="font-mono text-[var(--text-primary)]">
                {project.projectName}
              </span>
            </div>
            <input
              autoFocus
              value={deleteInput}
              disabled={deleting}
              onChange={(e) => setDeleteInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  deleteInput === project.projectName
                ) {
                  e.preventDefault();
                  void performDeleteFromDisk();
                }
              }}
              placeholder={project.projectName}
              className="mt-2 w-full text-[11px] px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
              style={{ fontFamily: '"Geist Mono", monospace' }}
            />
          </>
        }
        confirmLabel={t.panel_project_delete_button}
        busyLabel={t.panel_project_delete_button_busy}
        confirmTone="danger"
        busy={deleting}
        disableConfirm={deleteInput !== project.projectName}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => void performDeleteFromDisk()}
      />
      <ConfirmDialog
        open={confirmingRemove}
        title={t.panel_project_remove_title}
        body={removeProjectBody}
        confirmLabel={t.panel_project_remove_button}
        confirmTone="danger"
        onCancel={() => setConfirmingRemove(false)}
        onConfirm={performRemoveProject}
      />
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
