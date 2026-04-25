import { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useTaskStore } from "../stores/taskStore";
import type { Task, TaskEvent } from "../types";
import {
  PANEL_TRANSITION_DURATION_MS,
  PANEL_TRANSITION_EASING_CSS,
} from "../utils/panelAnimation";
import { ConfirmDialog } from "./ui/ConfirmDialog";

const DRAWER_WIDTH = 320;
const TOOLBAR_HEIGHT = 44;

export { DRAWER_WIDTH };

function StatusDot({ status }: { status: Task["status"] }) {
  if (status === "done") {
    return (
      <span
        className="shrink-0 w-1.5 h-1.5 rounded-full bg-green-500"
        title="Done"
      />
    );
  }
  if (status === "dropped") {
    return (
      <span
        className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--text-faint)]"
        title="Dropped"
      />
    );
  }
  return (
    <span
      className="shrink-0 w-1.5 h-1.5 rounded-full border border-[var(--text-muted)]"
      title="Open"
    />
  );
}

function TaskCard({
  task,
  onUpdated,
}: {
  task: Task;
  onUpdated: (updated: Task) => void;
}) {
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

  return (
    <>
      <div
        className="group relative rounded-md bg-[var(--surface)] hover:bg-[var(--sidebar-hover)] border border-transparent hover:border-[var(--border)] transition-colors cursor-pointer"
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
                  {task.links.length} link{task.links.length !== 1 ? "s" : ""}
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
              title="Mark done"
              disabled={busy}
              onClick={handleMarkDone}
            >
              ✓
            </button>
          ) : (
            <button
              className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors text-[11px]"
              title="Reopen"
              disabled={busy}
              onClick={handleReopen}
            >
              ↩
            </button>
          )}
          <button
            className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-faint)] hover:text-[var(--red,#ef4444)] hover:bg-[var(--red-soft,rgba(239,68,68,0.1))] transition-colors"
            title="Delete"
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
        title="Delete task"
        body="This will permanently delete the task. Continue?"
        confirmLabel="Delete"
        confirmTone="danger"
        busy={busy}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}

function NewTaskForm({
  projectPath,
  onCreated,
  onCancel,
}: {
  projectPath: string;
  onCreated: (task: Task) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) {
      if (!trimmed) onCancel();
      return;
    }
    setBusy(true);
    try {
      const task = await window.termcanvas.tasks.create({
        title: trimmed,
        repo: projectPath,
        body: body.trim(),
      });
      onCreated(task);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 p-2 border-t border-[var(--border)]">
      <input
        ref={inputRef}
        className="w-full text-[11px] px-2 py-1 rounded bg-[var(--background)] border border-[var(--accent)] text-[var(--text-primary)] outline-none disabled:opacity-50"
        style={{ fontFamily: '"Geist Mono", monospace' }}
        placeholder="Task title"
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <textarea
        className="w-full text-[10px] px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)] text-[var(--text-primary)] outline-none resize-none focus:border-[var(--accent)] disabled:opacity-50"
        style={{ fontFamily: '"Geist Mono", monospace' }}
        placeholder="Description (optional)"
        rows={2}
        value={body}
        disabled={busy}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex gap-1.5">
        <button
          className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent)] text-white disabled:opacity-50"
          disabled={busy || !title.trim()}
          onClick={() => void submit()}
        >
          Add
        </button>
        <button
          className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)]"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function TaskDrawer() {
  const collapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const openProjectPath = useTaskStore((s) => s.openProjectPath);
  const tasksByProject = useTaskStore((s) => s.tasksByProject);
  const closeDrawer = useTaskStore((s) => s.closeDrawer);
  const setTasks = useTaskStore((s) => s.setTasks);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const removeTask = useTaskStore((s) => s.removeTask);

  const [showNewForm, setShowNewForm] = useState(false);

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

  const handleTaskCreated = useCallback(
    (task: Task) => {
      if (openProjectPath) {
        upsertTask(openProjectPath, task);
        setShowNewForm(false);
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
        width: DRAWER_WIDTH,
        transform: isOpen ? "translateX(0)" : `translateX(-${DRAWER_WIDTH}px)`,
        transition: `transform ${PANEL_TRANSITION_DURATION_MS}ms ${PANEL_TRANSITION_EASING_CSS}`,
        pointerEvents: isOpen ? "auto" : "none",
      }}
      aria-hidden={!isOpen}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
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
          aria-label="Close task drawer"
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
            Loading…
          </div>
        ) : tasks.length === 0 && !showNewForm ? (
          <div className="px-3 py-6 text-[10px] text-[var(--text-faint)] text-center leading-relaxed">
            No tasks yet. Agents working in this project will record them here,
            or click + to add one.
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
      {showNewForm && openProjectPath ? (
        <NewTaskForm
          projectPath={openProjectPath}
          onCreated={handleTaskCreated}
          onCancel={() => setShowNewForm(false)}
        />
      ) : (
        <div className="shrink-0 border-t border-[var(--border)] px-2 py-1.5">
          <button
            className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--sidebar-hover)] transition-colors"
            onClick={() => setShowNewForm(true)}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path
                d="M6 2V10M2 6H10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            New task
          </button>
        </div>
      )}
    </div>
  );
}
