import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent } from "react";
import {
  useCanvasStore,
  COLLAPSED_TAB_WIDTH,
  PIN_DRAWER_WIDTH,
} from "../stores/canvasStore";
import { usePinStore } from "../stores/pinStore";
import { usePinDragStore } from "../stores/pinDragStore";
import type { Pin } from "../types";
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

const TOOLBAR_HEIGHT = 44;

function StatusBadge({ status }: { status: Pin["status"] }) {
  const t = useT();
  if (status === "done") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/25 font-medium">
        {t["pin.statusDone"]}
      </span>
    );
  }
  if (status === "dropped") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--surface-hover)] text-[var(--text-faint)] border border-[var(--border)] font-medium">
        {t["pin.statusDropped"]}
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/25 font-medium">
      {t["pin.statusOpen"]}
    </span>
  );
}

export function PinDetailDrawer() {
  const t = useT();
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const rightPanelWidth = useCanvasStore((s) => s.rightPanelWidth);
  const openDetailPinId = usePinStore((s) => s.openDetailPinId);
  const openProjectPath = usePinStore((s) => s.openProjectPath);
  const composingForPin = usePinStore((s) => s.composingForPin);
  const pinsByProject = usePinStore((s) => s.pinsByProject);
  const closeDetail = usePinStore((s) => s.closeDetail);
  const cancelCompose = usePinStore((s) => s.cancelCompose);
  const openDetail = usePinStore((s) => s.openDetail);
  const upsertPin = usePinStore((s) => s.upsertPin);
  const removePin = usePinStore((s) => s.removePin);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const pin: Pin | null =
    openDetailPinId && openProjectPath
      ? ((pinsByProject[openProjectPath] ?? []).find(
          (t) => t.id === openDetailPinId,
        ) ?? null)
      : null;

  // Compose mode: drawer is open showing a blank new-pin form for a project,
  // but no pin has been persisted yet. Mutually exclusive with viewing an
  // existing pin.
  const isComposing = !pin && composingForPin !== null;
  const isOpen = pin !== null || isComposing;
  const isEditing = editing || isComposing;

  // Initialize blank fields when entering compose mode.
  useEffect(() => {
    if (isComposing) {
      setEditTitle("");
      setEditBody("");
    }
  }, [composingForPin, isComposing]);

  // Reset edit state when pin changes (existing pin path)
  useEffect(() => {
    if (!pin) {
      setEditing(false);
    }
  }, [pin?.id]);

  // Focus title input when entering edit or compose mode
  useEffect(() => {
    if (isEditing) {
      titleInputRef.current?.focus();
    }
  }, [isEditing]);

  const handleStartEdit = useCallback(() => {
    if (!pin) return;
    setEditTitle(pin.title);
    setEditBody(pin.body);
    setEditing(true);
  }, [pin]);

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
      if (!composingForPin) return;
      setBusy(true);
      try {
        const created = await window.termcanvas.pins.create({
          repo: composingForPin,
          title: editTitle.trim() || t["pin.untitled"],
          body: editBody,
        });
        upsertPin(created.repo, created);
        // openDetail also clears composingForPin in the store.
        openDetail(created.id);
        setEditing(false);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!pin) return;
    setBusy(true);
    try {
      const updated = await window.termcanvas.pins.update(pin.repo, pin.id, {
        title: editTitle.trim() || pin.title,
        body: editBody,
      });
      upsertPin(pin.repo, updated);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }, [
    pin,
    busy,
    editTitle,
    editBody,
    upsertPin,
    isComposing,
    composingForPin,
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
    async (status: Pin["status"]) => {
      if (!pin || busy) return;
      setBusy(true);
      try {
        const updated = await window.termcanvas.pins.update(
          pin.repo,
          pin.id,
          { status },
        );
        upsertPin(pin.repo, updated);
      } finally {
        setBusy(false);
      }
    },
    [pin, busy, upsertPin],
  );

  const uploadAndInsert = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        // Resolve a target pin. In compose mode the pin doesn't exist yet —
        // materialize it with whatever the user has typed so far so we have
        // an id to attach the image to. After this point we're effectively
        // editing the just-created pin.
        let targetRepo: string;
        let targetId: string;
        if (pin) {
          targetRepo = pin.repo;
          targetId = pin.id;
        } else if (isComposing && composingForPin) {
          const created = await window.termcanvas.pins.create({
            repo: composingForPin,
            title: editTitle.trim() || t["pin.untitled"],
            body: editBody,
          });
          upsertPin(created.repo, created);
          // openDetail clears composingForPin; setEditing keeps the user
          // in edit mode of the new pin so they can continue typing and
          // pasting more images.
          openDetail(created.id);
          setEditing(true);
          targetRepo = created.repo;
          targetId = created.id;
        } else {
          return;
        }
        const buffer = await file.arrayBuffer();
        const result = await window.termcanvas.pins.saveAttachment(
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
      pin,
      isComposing,
      composingForPin,
      editTitle,
      editBody,
      upsertPin,
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
    if (!pin || busy) return;
    setBusy(true);
    try {
      await window.termcanvas.pins.remove(pin.repo, pin.id);
      removePin(pin.repo, pin.id);
      setShowDeleteConfirm(false);
      closeDetail();
    } finally {
      setBusy(false);
    }
  }, [pin, busy, removePin, closeDetail]);

  // Keyboard handlers — latest-ref pattern: the listener is mounted once per
  // open/close cycle, but reads the freshest state and callbacks via a ref so
  // every keystroke in edit mode doesn't tear down + rebind window listeners.
  const keyboardRef = useRef({
    isEditing,
    showDeleteConfirm,
    handleCancelEdit,
    handleSaveEdit,
    handleCloseDrawer,
  });
  keyboardRef.current = {
    isEditing,
    showDeleteConfirm,
    handleCancelEdit,
    handleSaveEdit,
    handleCloseDrawer,
  };
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      const k = keyboardRef.current;
      if (e.key === "Escape") {
        if (k.showDeleteConfirm) return;
        if (k.isEditing) {
          e.stopPropagation();
          k.handleCancelEdit();
        } else {
          e.stopPropagation();
          k.handleCloseDrawer();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && k.isEditing) {
        e.preventDefault();
        void k.handleSaveEdit();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [isOpen]);

  // The detail drawer always renders to the right of the pin drawer,
  // so its left edge IS the drawer-aware left inset (left panel +
  // PIN_DRAWER_WIDTH). composingForPin and openDetailPinId both
  // require openProjectPath, so by the time isOpen is true the pin
  // drawer is open and the +320 is folded into the inset.
  const pinDrawerOpen =
    openProjectPath !== null || composingForPin !== null;
  const effectiveLeftInset =
    (leftPanelCollapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth) +
    (pinDrawerOpen ? PIN_DRAWER_WIDTH : 0);
  const rightInset = rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : rightPanelWidth;

  // Memoize markdown parse so editing-buffer re-renders or unrelated parent
  // updates don't re-parse a multi-KB body and re-construct a Marked
  // renderer instance every cycle. Only repaints on body / attachments / mode.
  const bodyHtml = useMemo(
    () =>
      pin && !isEditing && pin.body
        ? renderMarkdownWithAttachments(pin.body, pin.attachmentsUrl)
        : "",
    [pin?.body, pin?.attachmentsUrl, isEditing, pin],
  );

  return (
    <>
      <div
        className="fixed bg-[var(--bg)] border-l border-[var(--border)] flex flex-col overflow-hidden shadow-xl"
        style={{
          zIndex: 45,
          top: TOOLBAR_HEIGHT,
          left: effectiveLeftInset,
          height: `calc(100vh - ${TOOLBAR_HEIGHT}px)`,
          width: `calc(100vw - ${effectiveLeftInset}px - ${rightInset}px)`,
          opacity: isOpen ? 1 : 0,
          transition: `opacity ${PANEL_TRANSITION_DURATION_MS}ms ${PANEL_TRANSITION_EASING_CSS}, left ${PANEL_TRANSITION_DURATION_MS}ms ${PANEL_TRANSITION_EASING_CSS}, width ${PANEL_TRANSITION_DURATION_MS}ms ${PANEL_TRANSITION_EASING_CSS}`,
          pointerEvents: isOpen ? "auto" : "none",
        }}
        aria-hidden={!isOpen}
        role="dialog"
        aria-modal="false"
        aria-label={pin?.title ?? "Pin detail"}
      >
        {/* Header strip — also a drag source for the current pin.
            py-2.5 keeps this header's bottom border on the same Y as the
            LeftPanel section header and the PinDrawer header. */}
        <div
          className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]"
          draggable={!!pin && !isEditing}
          onDragStart={(e) => {
            if (!pin || isEditing) return;
            e.dataTransfer.setData(
              "application/x-termcanvas-pin",
              JSON.stringify({ repo: pin.repo, id: pin.id }),
            );
            e.dataTransfer.effectAllowed = "copy";
            usePinDragStore.getState().setActive(true);
            window.dispatchEvent(new CustomEvent("termcanvas:pin-drag-active"));
          }}
          onDragEnd={() => {
            usePinDragStore.getState().setActive(false);
            window.dispatchEvent(new CustomEvent("termcanvas:pin-drag-end"));
          }}
          style={{ cursor: pin && !isEditing ? "grab" : undefined }}
        >
          <div className="flex items-center gap-2.5">
            <button
              className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
              onClick={handleCloseDrawer}
              aria-label={t["pin.closeDetail"]}
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
            {pin && <StatusBadge status={pin.status} />}
            {isComposing && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/25 font-medium">
                {t["pin.compose.newPill"]}
              </span>
            )}
          </div>

          {pin && (
            <div className="flex items-center gap-1.5">
              {!editing && (
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-hover)] transition-colors disabled:opacity-50"
                  disabled={busy}
                  onClick={handleStartEdit}
                >
                  {t["pin.action.edit"]}
                </button>
              )}
              {pin.status === "open" && (
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:bg-green-500/20 hover:text-green-600 transition-colors disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void handleStatusChange("done")}
                >
                  {t["pin.action.markDone"]}
                </button>
              )}
              {(pin.status === "done" || pin.status === "dropped") && (
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void handleStatusChange("open")}
                >
                  {t["pin.action.reopen"]}
                </button>
              )}
              {pin.status === "open" && (
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void handleStatusChange("dropped")}
                >
                  {t["pin.action.drop"]}
                </button>
              )}
              <div className="w-px h-3 bg-[var(--border)] mx-0.5" />
              <button
                className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--red,#ef4444)] hover:bg-[var(--red-soft,rgba(239,68,68,0.1))] transition-colors disabled:opacity-50"
                disabled={busy}
                onClick={() => setShowDeleteConfirm(true)}
              >
                {t["pin.action.delete"]}
              </button>
            </div>
          )}
        </div>

        {/* Reading column */}
        {(pin || isComposing) && (
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
                    placeholder={t["pin.titlePlaceholder"]}
                  />
                ) : (
                  <h1 className="text-2xl font-semibold text-[var(--text-primary)] break-words">
                    {pin?.title}
                  </h1>
                )}
              </div>

              {/* Meta line — only for existing pins */}
              {pin && !isComposing && (
                <div className="text-[11px] text-[var(--text-muted)] mb-6 flex items-center gap-1.5 flex-wrap">
                  <span>
                    {t["pin.meta.created"](
                      t["pin.relativeTime"](
                        Date.now() - new Date(pin.created).getTime(),
                      ),
                    )}
                  </span>
                  <span>·</span>
                  <span>
                    {t["pin.meta.updated"](
                      t["pin.relativeTime"](
                        Date.now() - new Date(pin.updated).getTime(),
                      ),
                    )}
                  </span>
                  {pin.links.length > 0 && (
                    <>
                      <span>·</span>
                      <span>{t["pin.linkCount"](pin.links.length)}</span>
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
                    placeholder={t["pin.bodyPlaceholder"]}
                    rows={10}
                  />
                ) : pin?.body ? (
                  <div
                    className={markdownClassName}
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  />
                ) : (
                  <p className="text-[var(--text-faint)] italic text-[13px]">
                    {t["pin.emptyBody"]}
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
                    {isComposing ? t["pin.create"] : t.save}
                  </button>
                  <button
                    className="text-[11px] px-3 py-1 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                    onClick={handleCancelEdit}
                  >
                    {t.cancel}
                  </button>
                  <span className="text-[10px] text-[var(--text-faint)] ml-1">
                    {t["pin.keyboardHint"]}
                  </span>
                  {uploading && (
                    <span className="text-[10px] text-[var(--text-muted)] ml-auto">
                      {t["pin.uploading"]}
                    </span>
                  )}
                </div>
              )}

              {/* Links section */}
              {!isEditing && pin && pin.links.length > 0 && (
                <div>
                  <div
                    className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] font-medium mb-2"
                    style={{ fontFamily: '"Geist Mono", monospace' }}
                  >
                    {t["pin.links"]}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {pin.links.map((link, i) => (
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
        title={t["pin.deleteConfirm.title"]}
        body={t["pin.deleteConfirm.body"]}
        confirmLabel={t["pin.deleteConfirm.action"]}
        confirmTone="danger"
        busy={busy}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
