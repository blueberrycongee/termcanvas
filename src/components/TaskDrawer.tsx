import { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useTaskStore } from "../stores/taskStore";
import type { Task, TaskEvent } from "../types";
import {
  PANEL_TRANSITION_DURATION_MS,
  PANEL_TRANSITION_EASING_CSS,
} from "../utils/panelAnimation";

const DRAWER_WIDTH = 320;
const TOOLBAR_HEIGHT = 44;

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
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editBody, setEditBody] = useState(task.body);
  const [busy, setBusy] = useState(false);

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

  const handleDrop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const updated = await window.termcanvas.tasks.update(task.repo, task.id, {
        status: "dropped",
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

  const handleSaveEdit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await window.termcanvas.tasks.update(task.repo, task.id, {
        title: editTitle,
        body: editBody,
      });
      onUpdated(updated);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const titleClass =
    task.status === "dropped"
      ? "line-through text-[var(--text-faint)]"
      : "text-[var(--text-primary)]";

  return (
    <div
      className="rounded-md bg-[var(--surface)] hover:bg-[var(--sidebar-hover)] border border-transparent hover:border-[var(--border)] transition-colors cursor-pointer"
      onClick={() => {
        if (!editing) setExpanded((v) => !v);
      }}
    >
      <div className="flex items-start gap-2 px-2.5 py-2">
        <div className="mt-1">
          <StatusDot status={task.status} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={`text-[11px] font-medium truncate leading-tight ${titleClass}`}
          >
            {task.title}
          </div>
          {!expanded && firstLine && (
            <div className="text-[10px] text-[var(--text-faint)] truncate mt-0.5">
              {firstLine}
            </div>
          )}
          {!expanded && task.links.length > 0 && (
            <div className="mt-1">
              <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] border border-[var(--border)]">
                {task.links.length} link{task.links.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div
          className="px-2.5 pb-2 border-t border-[var(--border)]"
          onClick={(e) => e.stopPropagation()}
        >
          {editing ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <input
                className="w-full text-[11px] px-2 py-1 rounded bg-[var(--background)] border border-[var(--accent)] text-[var(--text-primary)] outline-none"
                style={{ fontFamily: '"Geist Mono", monospace' }}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                disabled={busy}
              />
              <textarea
                className="w-full text-[10px] px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)] text-[var(--text-primary)] outline-none resize-none focus:border-[var(--accent)]"
                style={{ fontFamily: '"Geist Mono", monospace' }}
                rows={4}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                disabled={busy}
              />
              <div className="flex gap-1.5">
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent)] text-white disabled:opacity-50"
                  disabled={busy || !editTitle.trim()}
                  onClick={handleSaveEdit}
                >
                  Save
                </button>
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)]"
                  onClick={() => {
                    setEditing(false);
                    setEditTitle(task.title);
                    setEditBody(task.body);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {task.body && (
                <p className="mt-2 text-[10px] text-[var(--text-secondary)] whitespace-pre-wrap break-words leading-relaxed">
                  {task.body}
                </p>
              )}
              {task.links.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {task.links.map((link, i) => (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] text-[var(--accent)] underline truncate"
                    >
                      {link.type}: {link.id ?? link.url}
                    </a>
                  ))}
                </div>
              )}
              <div className="mt-2 flex gap-1.5">
                {task.status === "open" && (
                  <>
                    <button
                      className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:bg-green-500/20 hover:text-green-600 transition-colors disabled:opacity-50"
                      disabled={busy}
                      onClick={handleMarkDone}
                    >
                      Mark done
                    </button>
                    <button
                      className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-50"
                      disabled={busy}
                      onClick={handleDrop}
                    >
                      Drop
                    </button>
                  </>
                )}
                {(task.status === "done" || task.status === "dropped") && (
                  <button
                    className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-50"
                    disabled={busy}
                    onClick={handleReopen}
                  >
                    Reopen
                  </button>
                )}
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                  onClick={() => {
                    setEditTitle(task.title);
                    setEditBody(task.body);
                    setEditing(true);
                  }}
                >
                  Edit
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
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
