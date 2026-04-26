import { memo, useCallback, useEffect, useState } from "react";
import {
  useCanvasStore,
  COLLAPSED_TAB_WIDTH,
  PIN_DRAWER_WIDTH,
} from "../stores/canvasStore";
import { usePinStore } from "../stores/pinStore";
import { usePinDragStore } from "../stores/pinDragStore";
import type { Pin, PinEvent } from "../types";
import {
  PANEL_TRANSITION_DURATION_MS,
  PANEL_TRANSITION_EASING_CSS,
} from "../utils/panelAnimation";
import { useT } from "../i18n/useT";
import { ConfirmDialog } from "./ui/ConfirmDialog";

const TOOLBAR_HEIGHT = 44;

function StatusDot({ status }: { status: Pin["status"] }) {
  const t = useT();
  if (status === "done") {
    return (
      <span
        className="shrink-0 w-1.5 h-1.5 rounded-full bg-green-500"
        title={t["pin.statusDone"]}
      />
    );
  }
  if (status === "dropped") {
    return (
      <span
        className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--text-faint)]"
        title={t["pin.statusDropped"]}
      />
    );
  }
  return (
    <span
      className="shrink-0 w-1.5 h-1.5 rounded-full border border-[var(--text-muted)]"
      title={t["pin.statusOpen"]}
    />
  );
}

// Memoised so a pin event that touches one row doesn't re-render every other
// card. upsertPin preserves object identity for unchanged pins (it only
// substitutes the affected slot in the array), so default shallow compare
// on `pin` and `onUpdated` is enough.
const PinCard = memo(function PinCard({
  pin,
  onUpdated,
}: {
  pin: Pin;
  onUpdated: (updated: Pin) => void;
}) {
  const t = useT();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const openDetail = usePinStore((s) => s.openDetail);
  const removePin = usePinStore((s) => s.removePin);

  const firstLine = pin.body.split("\n")[0] ?? "";

  const handleMarkDone = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const updated = await window.termcanvas.pins.update(pin.repo, pin.id, {
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
      const updated = await window.termcanvas.pins.update(pin.repo, pin.id, {
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
      await window.termcanvas.pins.remove(pin.repo, pin.id);
      removePin(pin.repo, pin.id);
      setShowDeleteConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  const titleClass =
    pin.status === "dropped"
      ? "line-through text-[var(--text-faint)]"
      : "text-[var(--text-primary)]";

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(
      "application/x-termcanvas-pin",
      JSON.stringify({ repo: pin.repo, id: pin.id }),
    );
    e.dataTransfer.effectAllowed = "copy";
    usePinDragStore.getState().setActive(true);
    window.dispatchEvent(new CustomEvent("termcanvas:pin-drag-active"));
  };

  const handleDragEnd = () => {
    usePinDragStore.getState().setActive(false);
    window.dispatchEvent(new CustomEvent("termcanvas:pin-drag-end"));
  };

  return (
    <>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className="group relative rounded-md bg-[var(--surface)] hover:bg-[var(--sidebar-hover)] border border-transparent hover:border-[var(--border)] transition-colors cursor-grab active:cursor-grabbing"
        onClick={() => openDetail(pin.id)}
      >
        <div className="flex items-start gap-2 px-2.5 py-2 pr-16">
          <div className="mt-1">
            <StatusDot status={pin.status} />
          </div>
          <div className="flex-1 min-w-0">
            <div
              className={`text-[11px] font-medium truncate leading-tight ${titleClass}`}
            >
              {pin.title}
            </div>
            {firstLine && (
              <div className="text-[10px] text-[var(--text-faint)] truncate mt-0.5">
                {firstLine}
              </div>
            )}
            {pin.links.length > 0 && (
              <div className="mt-1">
                <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] border border-[var(--border)]">
                  {t["pin.linkCount"](pin.links.length)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Hover-revealed quick actions */}
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {pin.status === "open" ? (
            <button
              className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-faint)] hover:text-green-500 hover:bg-green-500/10 transition-colors text-[11px]"
              title={t["pin.action.markDone"]}
              disabled={busy}
              onClick={handleMarkDone}
            >
              ✓
            </button>
          ) : (
            <button
              className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors text-[11px]"
              title={t["pin.action.reopen"]}
              disabled={busy}
              onClick={handleReopen}
            >
              ↩
            </button>
          )}
          <button
            className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-faint)] hover:text-[var(--red,#ef4444)] hover:bg-[var(--red-soft,rgba(239,68,68,0.1))] transition-colors"
            title={t["pin.action.delete"]}
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
});

export function PinDrawer() {
  const t = useT();
  const collapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const openProjectPath = usePinStore((s) => s.openProjectPath);
  const pinsByProject = usePinStore((s) => s.pinsByProject);
  const closeDrawer = usePinStore((s) => s.closeDrawer);
  const setPins = usePinStore((s) => s.setPins);
  const upsertPin = usePinStore((s) => s.upsertPin);
  const removePin = usePinStore((s) => s.removePin);
  const startCompose = usePinStore((s) => s.startCompose);
  const showCompleted = usePinStore((s) => s.showCompleted);
  const toggleShowCompleted = usePinStore((s) => s.toggleShowCompleted);

  const isOpen = openProjectPath !== null;
  const pins = openProjectPath ? (pinsByProject[openProjectPath] ?? null) : null;
  const visiblePins =
    pins === null
      ? null
      : showCompleted
        ? pins
        : pins.filter((pin) => pin.status === "open");

  const leftOffset = collapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth;

  useEffect(() => {
    const unsub = window.termcanvas.pins.subscribe((event: PinEvent) => {
      if (event.type === "pin:created" || event.type === "pin:updated") {
        upsertPin(event.repo, event.pin);
      } else if (event.type === "pin:removed") {
        removePin(event.repo, event.id);
      }
    });
    return unsub;
  }, [upsertPin, removePin]);

  const handlePinUpdated = useCallback(
    (updated: Pin) => {
      if (openProjectPath) {
        upsertPin(openProjectPath, updated);
      }
    },
    [openProjectPath, upsertPin],
  );

  const projectName = openProjectPath
    ? openProjectPath.split("/").pop() ?? openProjectPath
    : "";

  return (
    <div
      className="fixed bg-[var(--surface)] border-r border-[var(--border)] flex flex-col overflow-hidden"
      style={{
        zIndex: 39,
        top: TOOLBAR_HEIGHT,
        left: leftOffset,
        height: `calc(100vh - ${TOOLBAR_HEIGHT}px)`,
        width: PIN_DRAWER_WIDTH,
        transform: isOpen ? "translateX(0)" : `translateX(-${PIN_DRAWER_WIDTH}px)`,
        // `transform` rides the role-based motion tokens; `left` stays on
        // PANEL_TRANSITION because it must track LeftPanel's width tween.
        transition:
          `transform var(--duration-natural) var(--ease-out-soft), ` +
          `left ${PANEL_TRANSITION_DURATION_MS}ms ${PANEL_TRANSITION_EASING_CSS}`,
        boxShadow: "var(--shadow-elev-1)",
        pointerEvents: isOpen ? "auto" : "none",
      }}
      aria-hidden={!isOpen}
    >
      {/* Header — py-2.5 (not py-2) so this header's bottom border aligns
          with LeftPanel's 41px section header on the same Y. */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-[var(--border)]">
        <span
          className="tc-eyebrow tc-mono truncate min-w-0"
          title={openProjectPath ?? ""}
        >
          {projectName}
        </span>
        <div className="shrink-0 flex items-center gap-0.5">
          <button
            className={`flex items-center justify-center w-5 h-5 rounded transition-colors ${
              showCompleted
                ? "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                : "text-[var(--accent)] hover:bg-[var(--accent)]/10"
            }`}
            onClick={toggleShowCompleted}
            aria-label={
              showCompleted
                ? t["pin.filter.hideCompletedLabel"]
                : t["pin.filter.showAllLabel"]
            }
            title={
              showCompleted
                ? t["pin.filter.hideCompletedLabel"]
                : t["pin.filter.showAllLabel"]
            }
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path
                d="M1.5 3h9M3 6h6M4.5 9h3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            className="flex items-center justify-center w-5 h-5 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
            onClick={closeDrawer}
            aria-label={t["pin.closeDrawer"]}
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
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {pins === null || visiblePins === null ? (
          <div className="tc-caption px-3 py-4 text-center">
            {t["pin.loading"]}
          </div>
        ) : pins.length === 0 ? (
          <div className="tc-caption px-3 py-6 text-center leading-relaxed">
            {t["pin.emptyState"]}
          </div>
        ) : visiblePins.length === 0 ? (
          <div className="tc-caption px-3 py-6 text-center leading-relaxed">
            {t["pin.emptyAfterFilter"]}
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {visiblePins.map((pin) => (
              <PinCard
                key={pin.id}
                pin={pin}
                onUpdated={handlePinUpdated}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-[var(--border)] px-2 py-1.5">
        <button
          className="tc-meta tc-row-hover w-full flex items-center gap-1.5 px-2 py-1 rounded hover:text-[var(--text-secondary)] disabled:opacity-50"
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
          {t["pin.newPin"]}
        </button>
      </div>
    </div>
  );
}
