import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useSnapshotHistoryStore } from "../stores/snapshotHistoryStore";
import {
  appendSnapshotToHistory,
  relativeTimeLabel,
} from "../snapshotHistory";
import {
  readWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
} from "../snapshotState";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useNotificationStore } from "../stores/notificationStore";

const MONO_STYLE = { fontFamily: '"Geist Mono", monospace' } as const;

function IconHistory({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3.5a4.5 4.5 0 1 1-4.43 5.3" />
      <path d="M3.5 5.5V3.5h2" />
      <path d="M8 5.5V8l1.6 1.6" />
    </svg>
  );
}

function absoluteTimeLabel(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

export function SnapshotHistoryModal() {
  const open = useSnapshotHistoryStore((s) => s.open);
  const entries = useSnapshotHistoryStore((s) => s.entries);
  const selectedIndex = useSnapshotHistoryStore((s) => s.selectedIndex);
  const loading = useSnapshotHistoryStore((s) => s.loading);
  const pendingRestoreId = useSnapshotHistoryStore((s) => s.pendingRestoreId);
  const closeHistory = useSnapshotHistoryStore((s) => s.closeHistory);
  const setSelectedIndex = useSnapshotHistoryStore((s) => s.setSelectedIndex);
  const selectNext = useSnapshotHistoryStore((s) => s.selectNext);
  const selectPrev = useSnapshotHistoryStore((s) => s.selectPrev);
  const setPendingRestoreId = useSnapshotHistoryStore(
    (s) => s.setPendingRestoreId,
  );

  const backdropRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<Element | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Recompute relative timestamps on a slow tick so "12 minutes ago" turns
  // into "13 minutes ago" without the user reopening the modal.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement;
    return () => {
      if (prevFocusRef.current instanceof HTMLElement) {
        prevFocusRef.current.focus();
      }
    };
  }, [open]);

  const safeSelectedIndex = Math.min(
    selectedIndex,
    Math.max(0, entries.length - 1),
  );

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const selected = container.querySelector("[data-selected='true']");
    if (selected) selected.scrollIntoView({ block: "nearest" });
  }, [safeSelectedIndex, entries.length]);

  const selectedEntry = entries[safeSelectedIndex];

  const triggerRestore = useCallback((id: string | undefined) => {
    if (!id) return;
    setPendingRestoreId(id);
  }, [setPendingRestoreId]);

  const performRestore = useCallback(async () => {
    if (!pendingRestoreId || !window.termcanvas?.snapshots) return;
    setRestoring(true);
    try {
      // Always capture the current canvas before replacing it. Two reasons:
      // (1) gives the user a one-step undo if the restore was a mistake;
      // (2) makes "restore" non-destructive in practice — the pre-restore
      // state is just one row up in the same list.
      await appendSnapshotToHistory({ force: true });

      const body = await window.termcanvas.snapshots.read(pendingRestoreId);
      if (!body) {
        useNotificationStore
          .getState()
          .notify("error", "Snapshot could not be read.");
        return;
      }
      const restored = readWorkspaceSnapshot(body);
      if (!restored || "skipRestore" in restored) {
        useNotificationStore
          .getState()
          .notify("error", "Snapshot is empty or unreadable.");
        return;
      }
      restoreWorkspaceSnapshot(restored);
      useWorkspaceStore.getState().setWorkspacePath(null);
      useWorkspaceStore.getState().markDirty();
      useNotificationStore.getState().notify("info", "Snapshot restored.");
      setPendingRestoreId(null);
      closeHistory();
    } catch (err) {
      console.error("[SnapshotHistoryModal] restore failed:", err);
      useNotificationStore.getState().notify("error", "Restore failed.");
    } finally {
      setRestoring(false);
    }
  }, [pendingRestoreId, setPendingRestoreId, closeHistory]);

  // Modal has no editable input, so we cannot piggyback on the input's
  // bubbling onKeyDown like SearchModal/CommandPalette do. Window listener
  // is the simpler path; ConfirmDialog (rendered atop us during restore)
  // owns Escape via its own listener and short-circuits ours by closing
  // first, so the two never fight.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (pendingRestoreId) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeHistory();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectNext();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        selectPrev();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        triggerRestore(entries[safeSelectedIndex]?.id);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    open,
    pendingRestoreId,
    closeHistory,
    selectNext,
    selectPrev,
    entries,
    safeSelectedIndex,
    triggerRestore,
  ]);

  const renderRow = useMemo(() => {
    return (
      entry: { id: string; savedAt: number; terminalCount: number; projectCount: number; label?: string },
      index: number,
    ) => {
      const isSelected = index === safeSelectedIndex;
      // Reading `tick` keeps relative labels (`relativeTimeLabel`) in sync
      // when the modal stays open across a minute boundary.
      void tick;
      return (
        <button
          key={entry.id}
          data-selected={isSelected}
          type="button"
          className="tc-cmd-row flex w-full items-center gap-3 px-4 py-2 text-left"
          style={{
            backgroundColor: isSelected ? "var(--accent-soft)" : undefined,
          }}
          onMouseEnter={() => setSelectedIndex(index)}
          onClick={() => triggerRestore(entry.id)}
        >
          <span
            aria-hidden
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-semibold"
            style={{
              ...MONO_STYLE,
              color: isSelected ? "var(--accent)" : "var(--text-muted)",
              backgroundColor: isSelected
                ? "color-mix(in srgb, var(--accent) 16%, transparent)"
                : "color-mix(in srgb, var(--text-muted) 10%, transparent)",
              transition:
                "color var(--duration-quick) var(--ease-out-soft), background-color var(--duration-quick) var(--ease-out-soft)",
            }}
          >
            H
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="tc-body-sm truncate"
              style={{
                fontWeight: isSelected ? 500 : 400,
              }}
            >
              {entry.label ?? "Snapshot"}
            </div>
            <div
              className="tc-meta truncate"
              title={absoluteTimeLabel(entry.savedAt)}
            >
              {relativeTimeLabel(entry.savedAt)} ·{" "}
              {entry.terminalCount} terminal
              {entry.terminalCount === 1 ? "" : "s"} ·{" "}
              {entry.projectCount} project
              {entry.projectCount === 1 ? "" : "s"}
            </div>
          </div>
          {isSelected && (
            <span
              className="shrink-0 text-[10px]"
              style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
            >
              Restore
            </span>
          )}
        </button>
      );
    };
  }, [safeSelectedIndex, setSelectedIndex, triggerRestore, tick]);

  if (!open) return null;

  return (
    <>
      <div
        ref={backdropRef}
        className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
        style={{ backgroundColor: "var(--scrim)" }}
        onClick={(e) => {
          if (e.target === backdropRef.current) closeHistory();
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Snapshot history"
      >
        <div
          className="tc-enter-fade-up w-full max-w-xl mx-4 overflow-hidden rounded-lg border shadow-2xl"
          style={{
            backgroundColor: "var(--bg)",
            borderColor: "var(--border)",
          }}
        >
          {/* Header — mirrors SearchModal/CommandPalette: glyph + label + ESC */}
          <div
            className="flex items-center gap-2.5 border-b px-4 py-3"
            style={{ borderColor: "var(--border)" }}
          >
            <span style={{ color: "var(--text-secondary)" }}>
              <IconHistory />
            </span>
            <div
              className="min-w-0 flex-1 text-[13px]"
              style={{ ...MONO_STYLE, color: "var(--text-primary)" }}
            >
              Snapshot history
            </div>
            <kbd
              className="shrink-0 rounded border px-1.5 py-0.5 text-[10px]"
              style={{
                ...MONO_STYLE,
                borderColor: "var(--border)",
                color: "var(--text-faint)",
              }}
            >
              ESC
            </kbd>
          </div>

          {/* Selection summary — analogue of SearchModal's scope row.
              Tells the user what they're about to restore *to*. */}
          {selectedEntry && (
            <div
              className="flex items-center gap-2 border-b px-4 py-2"
              style={{ borderColor: "var(--border)" }}
            >
              <span
                className="tc-meta truncate"
                style={{ ...MONO_STYLE }}
                title={absoluteTimeLabel(selectedEntry.savedAt)}
              >
                {absoluteTimeLabel(selectedEntry.savedAt)}
              </span>
              <span
                className="ml-auto truncate text-[11px]"
                style={{ ...MONO_STYLE, color: "var(--text-metadata)" }}
              >
                {selectedEntry.terminalCount} terminals ·{" "}
                {selectedEntry.projectCount} projects
              </span>
            </div>
          )}

          {/* List */}
          <div ref={listRef} className="max-h-[55vh] overflow-auto">
            {loading && entries.length === 0 ? (
              <div
                className="px-4 py-10 text-center text-[12px]"
                style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
              >
                Loading…
              </div>
            ) : entries.length === 0 ? (
              <div
                className="px-4 py-10 text-center text-[12px]"
                style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
              >
                No snapshots yet — auto-save will start capturing as you work.
              </div>
            ) : (
              entries.map(renderRow)
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between border-t px-3 py-2 text-[10px]"
            style={{
              ...MONO_STYLE,
              borderColor: "var(--border)",
              color: "var(--text-faint)",
            }}
          >
            <div className="flex items-center gap-3">
              <span>
                <kbd
                  className="rounded border px-1 py-0.5"
                  style={{ borderColor: "var(--border)" }}
                >
                  ↵
                </kbd>
                <span className="ml-1">restore</span>
              </span>
              <span>
                <kbd
                  className="rounded border px-1 py-0.5"
                  style={{ borderColor: "var(--border)" }}
                >
                  ↑↓
                </kbd>
                <span className="ml-1">navigate</span>
              </span>
            </div>
            <span className="hidden sm:inline">
              {entries.length}{" "}
              {entries.length === 1 ? "snapshot" : "snapshots"}
            </span>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={!!pendingRestoreId}
        title="Restore snapshot?"
        body={
          <span>
            Your current canvas will be replaced. A snapshot of the current
            state is saved first, so this is reversible from the same list.
          </span>
        }
        confirmLabel="Restore"
        busyLabel="Restoring…"
        confirmTone="danger"
        busy={restoring}
        onCancel={() => {
          if (restoring) return;
          setPendingRestoreId(null);
        }}
        onConfirm={() => {
          void performRestore();
        }}
      />
    </>
  );
}
