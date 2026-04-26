import { memo, useCallback, useEffect, useState } from "react";
import {
  useCanvasStore,
  COLLAPSED_TAB_WIDTH,
  TASK_DRAWER_WIDTH,
} from "../stores/canvasStore";
import { useTaskStore } from "../stores/taskStore";
import { useTaskDragStore } from "../stores/taskDragStore";
import type { Task, TaskEvent } from "../types";
import {
  PANEL_TRANSITION_DURATION_MS,
  PANEL_TRANSITION_EASING_CSS,
} from "../utils/panelAnimation";
import { useT } from "../i18n/useT";
import { ConfirmDialog } from "./ui/ConfirmDialog";

const TOOLBAR_HEIGHT = 44;

function StatusDot({ status }: { status: Task["status"] }) {
  const t = useT();
  if (status === "done") {
    return (
      <span
        className="shrink-0 w-1.5 h-1.5 rounded-full bg-green-500"
        title={t["task.statusDone"]}
      />
    );
  }
  if (status === "dropped") {
    return (
      <span
        className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--text-faint)]"
        title={t["task.statusDropped"]}
      />
    );
  }
  return (
    <span
      className="shrink-0 w-1.5 h-1.5 rounded-full border border-[var(--text-muted)]"
      title={t["task.statusOpen"]}
    />
  );
}

// Memoised so a task event that touches one row doesn't re-render every other
// card. upsertTask preserves object identity for unchanged tasks (it only
// substitutes the affected slot in the array), so default shallow compare
// on `task` and `onUpdated` is enough.
const TaskCard = memo(function TaskCard({
  task,
  onUpdated,
}: {
  task: Task;
  onUpdated: (updated: Task) => void;
}) {
  const t = useT();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const openDetail = useTaskStore((s) => s.openDetail);
  const removeTask = useTaskStore((s) => s.removeTask);

  const firstLine = task.body.split("\n")[0] ?? "";

  const handleMarkDone = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const updated = await window.termcanvas.tasks.update(task.repo, task.id, {
        status: "done",
      });
      onUpdated(updated);
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const updated = await window.termcanvas.tasks.update(task.repo, task.id, {
        status: "open",
      });
      onUpdated(updated);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await window.termcanvas.tasks.remove(task.repo, task.id);
      removeTask(task.repo, task.id);
      setShowDeleteConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  const titleClass =
    task.status === "dropped"
      ? "line-through text-[var(--text-faint)]"
      : "text-[var(--text-primary)]";

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(
      "application/x-termcanvas-task",
      JSON.stringify({ repo: task.repo, id: task.id }),
    );
    e.dataTransfer.effectAllowed = "copy";
    useTaskDragStore.getState().setActive(true);
    window.dispatchEvent(new CustomEvent("termcanvas:task-drag-active"));
  };

  const handleDragEnd = () => {
    useTaskDragStore.getState().setActive(false);
    window.dispatchEvent(new CustomEvent("termcanvas:task-drag-end"));
  };

  return (
    <>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className="group relative rounded-md bg-[var(--surface)] hover:bg-[var(--sidebar-hover)] border border-transparent hover:border-[var(--border)] transition-colors cursor-grab active:cursor-grabbing"
        onClick={() => openDetail(task.id)}
      >
        <div className="flex items-start gap-2 px-2.5 py-2 pr-16">
          <div className="mt-1">
            <StatusDot status={task.status} />
          </div>
          <div className="flex-1 min-w-0">
            <div
              className={`text-[11px] font-medium truncate leading-tight ${titleClass}`}
            >
              {task.title}
            </div>
            {firstLine && (
              <div className="text-[10px] text-[var(--text-faint)] truncate mt-0.5">
                {firstLine}
              </div>
            )}
            {task.links.length > 0 && (
              <div className="mt-1">
                <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] border border-[var(--border)]">
                  {t["task.linkCount"](task.links.length)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Hover-revealed quick actions */}
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {task.status === "open" ? (
            <button
              className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-faint)] hover:text-green-500 hover:bg-green-500/10 transition-colors text-[11px]"
              title={t["task.action.markDone"]}
              disabled={busy}
              onClick={handleMarkDone}
            >
              ✓
            </button>
          ) : (
            <button
              className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors text-[11px]"
              title={t["task.action.reopen"]}
              disabled={busy}
              onClick={handleReopen}
            >
              ↩
            </button>
          )}
          <button
            className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-faint)] hover:text-[var(--red,#ef4444)] hover:bg-[var(--red-soft,rgba(239,68,68,0.1))] transition-colors"
            title={t["task.action.delete"]}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              setShowDeleteConfirm(true);
            }}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 3h8M5 3V2h2v1M4 3v6.5a.5.5 0 00.5.5h3a.5.5 0 00.5-.5V3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title={t["task.deleteConfirm.title"]}
        body={t["task.deleteConfirm.body"]}
        confirmLabel={t["task.deleteConfirm.action"]}
        confirmTone="danger"
        busy={busy}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
});

export function TaskDrawer() {
  const t = useT();
  const collapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const openProjectPath = useTaskStore((s) => s.openProjectPath);
  const tasksByProject = useTaskStore((s) => s.tasksByProject);
  const closeDrawer = useTaskStore((s) => s.closeDrawer);
  const setTasks = useTaskStore((s) => s.setTasks);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const removeTask = useTaskStore((s) => s.removeTask);
  const startCompose = useTaskStore((s) => s.startCompose);

  const isOpen = openProjectPath !== null;
  const tasks = openProjectPath ? (tasksByProject[openProjectPath] ?? null) : null;

  const leftOffset = collapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth;

  useEffect(() => {
    const unsub = window.termcanvas.tasks.subscribe((event: TaskEvent) => {
      const { tasksByProject: current } = useTaskStore.getState();
      if (event.type === "task:created" || event.type === "task:updated") {
        if (current[event.repo] !== undefined) {
          upsertTask(event.repo, event.task);
        }
      } else if (event.type === "task:removed") {
        if (current[event.repo] !== undefined) {
          removeTask(event.repo, event.id);
        }
      }
    });
    return unsub;
  }, [upsertTask, removeTask]);

  const handleTaskUpdated = useCallback(
    (updated: Task) => {
      if (openProjectPath) {
        upsertTask(openProjectPath, updated);
      }
    },
    [openProjectPath, upsertTask],
  );

  const projectName = openProjectPath
    ? openProjectPath.split("/").pop() ?? openProjectPath
    : "";

  return (
    <div
      className="fixed bg-[var(--surface)] border-r border-[var(--border)] flex flex-col overflow-hidden shadow-lg"
      style={{
        zIndex: 39,
        top: TOOLBAR_HEIGHT,
        left: leftOffset,
        height: `calc(100vh - ${TOOLBAR_HEIGHT}px)`,
        width: TASK_DRAWER_WIDTH,
        transform: isOpen ? "translateX(0)" : `translateX(-${TASK_DRAWER_WIDTH}px)`,
        transition: `transform ${PANEL_TRANSITION_DURATION_MS}ms ${PANEL_TRANSITION_EASING_CSS}`,
        pointerEvents: isOpen ? "auto" : "none",
      }}
      aria-hidden={!isOpen}
    >
      {/* Header — py-2.5 (not py-2) so this header's bottom border aligns
          with LeftPanel's 41px section header on the same Y. */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-[var(--border)]">
        <span
          className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] font-medium truncate min-w-0"
          style={{ fontFamily: '"Geist Mono", monospace' }}
          title={openProjectPath ?? ""}
        >
          {projectName}
        </span>
        <button
          className="shrink-0 flex items-center justify-center w-5 h-5 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
          onClick={closeDrawer}
          aria-label={t["task.closeDrawer"]}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 2L8 8M8 2L2 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tasks === null ? (
          <div className="px-3 py-4 text-[10px] text-[var(--text-faint)] text-center">
            {t["task.loading"]}
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-3 py-6 text-[10px] text-[var(--text-faint)] text-center leading-relaxed">
            {t["task.emptyState"]}
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onUpdated={handleTaskUpdated}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-[var(--border)] px-2 py-1.5">
        <button
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--sidebar-hover)] transition-colors disabled:opacity-50"
          disabled={!openProjectPath}
          onClick={() => openProjectPath && startCompose(openProjectPath)}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path
              d="M6 2V10M2 6H10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          {t["task.newTask"]}
        </button>
      </div>
    </div>
  );
}
