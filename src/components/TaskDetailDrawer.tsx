import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent } from "react";
import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useTaskStore } from "../stores/taskStore";
import { useTaskDragStore } from "../stores/taskDragStore";
import type { Task } from "../types";
import {
  PANEL_TRANSITION_DURATION_MS,
  PANEL_TRANSITION_EASING_CSS,
} from "../utils/panelAnimation";
import {
  markdownClassName,
  renderMarkdownWithAttachments,
} from "../utils/markdownClass";
import { useT } from "../i18n/useT";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { DRAWER_WIDTH } from "./TaskDrawer";

const TOOLBAR_HEIGHT = 44;

function StatusBadge({ status }: { status: Task["status"] }) {
  const t = useT();
  if (status === "done") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/25 font-medium">
        {t["task.statusDone"]}
      </span>
    );
  }
  if (status === "dropped") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--surface-hover)] text-[var(--text-faint)] border border-[var(--border)] font-medium">
        {t["task.statusDropped"]}
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/25 font-medium">
      {t["task.statusOpen"]}
    </span>
  );
}

export function TaskDetailDrawer() {
  const t = useT();
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const rightPanelWidth = useCanvasStore((s) => s.rightPanelWidth);
  const openDetailTaskId = useTaskStore((s) => s.openDetailTaskId);
  const openProjectPath = useTaskStore((s) => s.openProjectPath);
  const composingForProject = useTaskStore((s) => s.composingForProject);
  const tasksByProject = useTaskStore((s) => s.tasksByProject);
  const closeDetail = useTaskStore((s) => s.closeDetail);
  const cancelCompose = useTaskStore((s) => s.cancelCompose);
  const openDetail = useTaskStore((s) => s.openDetail);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const removeTask = useTaskStore((s) => s.removeTask);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const task: Task | null =
    openDetailTaskId && openProjectPath
      ? ((tasksByProject[openProjectPath] ?? []).find(
          (t) => t.id === openDetailTaskId,
        ) ?? null)
      : null;

  // Compose mode: drawer is open showing a blank new-task form for a project,
  // but no task has been persisted yet. Mutually exclusive with viewing an
  // existing task.
  const isComposing = !task && composingForProject !== null;
  const isOpen = task !== null || isComposing;
  const isEditing = editing || isComposing;

  // Initialize blank fields when entering compose mode.
  useEffect(() => {
    if (isComposing) {
      setEditTitle("");
      setEditBody("");
    }
  }, [composingForProject, isComposing]);

  // Reset edit state when task changes (existing task path)
  useEffect(() => {
    if (!task) {
      setEditing(false);
    }
  }, [task?.id]);

  // Focus title input when entering edit or compose mode
  useEffect(() => {
    if (isEditing) {
      titleInputRef.current?.focus();
    }
  }, [isEditing]);

  const handleStartEdit = useCallback(() => {
    if (!task) return;
    setEditTitle(task.title);
    setEditBody(task.body);
    setEditing(true);
  }, [task]);

  const handleCancelEdit = useCallback(() => {
    if (isComposing) {
      cancelCompose();
    } else {
      setEditing(false);
    }
  }, [isComposing, cancelCompose]);

  const handleSaveEdit = useCallback(async () => {
    if (busy) return;
    if (isComposing) {
      if (!composingForProject) return;
      setBusy(true);
      try {
        const created = await window.termcanvas.tasks.create({
          repo: composingForProject,
          title: editTitle.trim() || t["task.untitled"],
          body: editBody,
        });
        upsertTask(created.repo, created);
        // openDetail also clears composingForProject in the store.
        openDetail(created.id);
        setEditing(false);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!task) return;
    setBusy(true);
    try {
      const updated = await window.termcanvas.tasks.update(task.repo, task.id, {
        title: editTitle.trim() || task.title,
        body: editBody,
      });
      upsertTask(task.repo, updated);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }, [
    task,
    busy,
    editTitle,
    editBody,
    upsertTask,
    isComposing,
    composingForProject,
    openDetail,
  ]);

  const handleCloseDrawer = useCallback(() => {
    if (isComposing) {
      cancelCompose();
    } else {
      closeDetail();
    }
  }, [isComposing, cancelCompose, closeDetail]);

  const handleStatusChange = useCallback(
    async (status: Task["status"]) => {
      if (!task || busy) return;
      setBusy(true);
      try {
        const updated = await window.termcanvas.tasks.update(
          task.repo,
          task.id,
          { status },
        );
        upsertTask(task.repo, updated);
      } finally {
        setBusy(false);
      }
    },
    [task, busy, upsertTask],
  );

  const uploadAndInsert = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        // Resolve a target task. In compose mode the task doesn't exist yet —
        // materialize it with whatever the user has typed so far so we have
        // an id to attach the image to. After this point we're effectively
        // editing the just-created task.
        let targetRepo: string;
        let targetId: string;
        if (task) {
          targetRepo = task.repo;
          targetId = task.id;
        } else if (isComposing && composingForProject) {
          const created = await window.termcanvas.tasks.create({
            repo: composingForProject,
            title: editTitle.trim() || t["task.untitled"],
            body: editBody,
          });
          upsertTask(created.repo, created);
          // openDetail clears composingForProject; setEditing keeps the user
          // in edit mode of the new task so they can continue typing and
          // pasting more images.
          openDetail(created.id);
          setEditing(true);
          targetRepo = created.repo;
          targetId = created.id;
        } else {
          return;
        }
        const buffer = await file.arrayBuffer();
        const result = await window.termcanvas.tasks.saveAttachment(
          targetRepo,
          targetId,
          file.name || "image",
          buffer,
        );
        const altText = file.name || "image";
        const snippet = `\n\n![${altText}](${result.relativePath})\n\n`;
        const textarea = bodyTextareaRef.current;
        setEditBody((prev) => {
          const start = textarea?.selectionStart ?? prev.length;
          const end = textarea?.selectionEnd ?? prev.length;
          const next = prev.slice(0, start) + snippet + prev.slice(end);
          if (textarea) {
            const cursor = start + snippet.length;
            requestAnimationFrame(() => {
              textarea.focus();
              textarea.setSelectionRange(cursor, cursor);
            });
          }
          return next;
        });
      } finally {
        setUploading(false);
      }
    },
    [
      task,
      isComposing,
      composingForProject,
      editTitle,
      editBody,
      upsertTask,
      openDetail,
    ],
  );

  const handleBodyPaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void uploadAndInsert(file);
          }
        }
      }
    },
    [uploadAndInsert],
  );

  const handleBodyDragOver = useCallback(
    (e: DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
    },
    [],
  );

  const handleBodyDrop = useCallback(
    (e: DragEvent<HTMLTextAreaElement>) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      let handled = false;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith("image/")) {
          handled = true;
          void uploadAndInsert(file);
        }
      }
      if (handled) e.preventDefault();
    },
    [uploadAndInsert],
  );

  const handleDelete = useCallback(async () => {
    if (!task || busy) return;
    setBusy(true);
    try {
      await window.termcanvas.tasks.remove(task.repo, task.id);
      removeTask(task.repo, task.id);
      setShowDeleteConfirm(false);
      closeDetail();
    } finally {
      setBusy(false);
    }
  }, [task, busy, removeTask, closeDetail]);

  // Keyboard handlers
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showDeleteConfirm) return;
        if (isEditing) {
          e.stopPropagation();
          handleCancelEdit();
        } else {
          e.stopPropagation();
          handleCloseDrawer();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && isEditing) {
        e.preventDefault();
        void handleSaveEdit();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [isOpen, isEditing, showDeleteConfirm, handleCancelEdit, handleSaveEdit, handleCloseDrawer]);

  const leftInset = leftPanelCollapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth;
  const rightInset = rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : rightPanelWidth;

  const bodyHtml =
    task && !isEditing && task.body
      ? renderMarkdownWithAttachments(task.body, task.attachmentsUrl)
      : "";

  return (
    <>
      <div
        className="fixed bg-[var(--bg)] border-l border-[var(--border)] flex flex-col overflow-hidden shadow-xl"
        style={{
          zIndex: 45,
          top: TOOLBAR_HEIGHT,
          left: leftInset + DRAWER_WIDTH,
          height: `calc(100vh - ${TOOLBAR_HEIGHT}px)`,
          width: `calc(100vw - ${leftInset + DRAWER_WIDTH}px - ${rightInset}px)`,
          opacity: isOpen ? 1 : 0,
          transition: `opacity ${PANEL_TRANSITION_DURATION_MS}ms ${PANEL_TRANSITION_EASING_CSS}`,
          pointerEvents: isOpen ? "auto" : "none",
        }}
        aria-hidden={!isOpen}
        role="dialog"
        aria-modal="false"
        aria-label={task?.title ?? "Task detail"}
      >
        {/* Header strip — also a drag source for the current task */}
        <div
          className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]"
          draggable={!!task && !isEditing}
          onDragStart={(e) => {
            if (!task || isEditing) return;
            e.dataTransfer.setData(
              "application/x-termcanvas-task",
              JSON.stringify({ repo: task.repo, id: task.id }),
            );
            e.dataTransfer.effectAllowed = "copy";
            useTaskDragStore.getState().setActive(true);
            window.dispatchEvent(new CustomEvent("termcanvas:task-drag-active"));
          }}
          onDragEnd={() => {
            useTaskDragStore.getState().setActive(false);
            window.dispatchEvent(new CustomEvent("termcanvas:task-drag-end"));
          }}
          style={{ cursor: task && !isEditing ? "grab" : undefined }}
        >
          <div className="flex items-center gap-2.5">
            <button
              className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
              onClick={handleCloseDrawer}
              aria-label={t["task.closeDetail"]}
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
            {task && <StatusBadge status={task.status} />}
            {isComposing && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/25 font-medium">
                {t["task.compose.newPill"]}
              </span>
            )}
          </div>

          {task && (
            <div className="flex items-center gap-1.5">
              {!editing && (
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-hover)] transition-colors disabled:opacity-50"
                  disabled={busy}
                  onClick={handleStartEdit}
                >
                  {t["task.action.edit"]}
                </button>
              )}
              {task.status === "open" && (
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:bg-green-500/20 hover:text-green-600 transition-colors disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void handleStatusChange("done")}
                >
                  {t["task.action.markDone"]}
                </button>
              )}
              {(task.status === "done" || task.status === "dropped") && (
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void handleStatusChange("open")}
                >
                  {t["task.action.reopen"]}
                </button>
              )}
              {task.status === "open" && (
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void handleStatusChange("dropped")}
                >
                  {t["task.action.drop"]}
                </button>
              )}
              <div className="w-px h-3 bg-[var(--border)] mx-0.5" />
              <button
                className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--red,#ef4444)] hover:bg-[var(--red-soft,rgba(239,68,68,0.1))] transition-colors disabled:opacity-50"
                disabled={busy}
                onClick={() => setShowDeleteConfirm(true)}
              >
                {t["task.action.delete"]}
              </button>
            </div>
          )}
        </div>

        {/* Reading column */}
        {(task || isComposing) && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4">
            <div className="mx-auto max-w-[720px] py-6">
              {/* Topic header */}
              <div className="mb-1">
                {isEditing ? (
                  <input
                    ref={titleInputRef}
                    className="w-full text-2xl font-semibold bg-transparent border-b border-[var(--accent)] text-[var(--text-primary)] outline-none pb-1 disabled:opacity-50"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    disabled={busy}
                    placeholder={t["task.titlePlaceholder"]}
                  />
                ) : (
                  <h1 className="text-2xl font-semibold text-[var(--text-primary)] break-words">
                    {task?.title}
                  </h1>
                )}
              </div>

              {/* Meta line — only for existing tasks */}
              {task && !isComposing && (
                <div className="text-[11px] text-[var(--text-muted)] mb-6 flex items-center gap-1.5 flex-wrap">
                  <span>
                    {t["task.meta.created"](
                      t["task.relativeTime"](
                        Date.now() - new Date(task.created).getTime(),
                      ),
                    )}
                  </span>
                  <span>·</span>
                  <span>
                    {t["task.meta.updated"](
                      t["task.relativeTime"](
                        Date.now() - new Date(task.updated).getTime(),
                      ),
                    )}
                  </span>
                  {task.links.length > 0 && (
                    <>
                      <span>·</span>
                      <span>{t["task.linkCount"](task.links.length)}</span>
                    </>
                  )}
                </div>
              )}
              {isComposing && <div className="mb-6" />}

              {/* Body */}
              <div className="mb-6">
                {isEditing ? (
                  <textarea
                    ref={bodyTextareaRef}
                    className="w-full text-[13px] px-3 py-2 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] outline-none resize-none focus:border-[var(--accent)] leading-relaxed disabled:opacity-50 min-h-[200px]"
                    style={{ fontFamily: '"Geist Mono", monospace' }}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    onPaste={handleBodyPaste}
                    onDragOver={handleBodyDragOver}
                    onDrop={handleBodyDrop}
                    disabled={busy}
                    placeholder={t["task.bodyPlaceholder"]}
                    rows={10}
                  />
                ) : task?.body ? (
                  <div
                    className={markdownClassName}
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  />
                ) : (
                  <p className="text-[var(--text-faint)] italic text-[13px]">
                    {t["task.emptyBody"]}
                  </p>
                )}
              </div>

              {/* Edit / compose mode footer */}
              {isEditing && (
                <div className="flex items-center gap-2 mb-6">
                  <button
                    className="text-[11px] px-3 py-1 rounded bg-[var(--accent)] text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                    disabled={busy || uploading || !editTitle.trim()}
                    onClick={() => void handleSaveEdit()}
                  >
                    {isComposing ? t["task.create"] : t.save}
                  </button>
                  <button
                    className="text-[11px] px-3 py-1 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                    onClick={handleCancelEdit}
                  >
                    {t.cancel}
                  </button>
                  <span className="text-[10px] text-[var(--text-faint)] ml-1">
                    {t["task.keyboardHint"]}
                  </span>
                  {uploading && (
                    <span className="text-[10px] text-[var(--text-muted)] ml-auto">
                      {t["task.uploading"]}
                    </span>
                  )}
                </div>
              )}

              {/* Links section */}
              {!isEditing && task && task.links.length > 0 && (
                <div>
                  <div
                    className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] font-medium mb-2"
                    style={{ fontFamily: '"Geist Mono", monospace' }}
                  >
                    {t["task.links"]}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {task.links.map((link, i) => (
                      <a
                        key={i}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 max-w-fit px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] border border-[var(--border)] font-medium uppercase tracking-wide shrink-0">
                          {link.type}
                        </span>
                        <span className="truncate max-w-[400px]">
                          {link.id ?? link.url}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
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
}
