import { useEffect } from "react";
import {
  useStatusDigestStore,
  type DigestSignal,
  type DigestSignalKind,
} from "../stores/statusDigestStore";
import {
  useCanvasStore,
  COLLAPSED_TAB_WIDTH,
} from "../stores/canvasStore";
import { panToTerminal } from "../utils/panToTerminal";
import { useT } from "../i18n/useT";

/**
 * Status digest — Cmd/Ctrl+Shift+/ surfaces a snapshot of the 3–5 most
 * relevant signals across the canvas: just-completed runs, stuck
 * agents, the busy ones, the currently-focused tile, and any pinned
 * terminals. Renders bottom-center so it doesn't fight the discovery
 * cue chip (top-center). Shares the chip chrome (.tc-discovery-chip)
 * to stay in the quiet capability-discovery register.
 */

const AUTO_DISMISS_MS = 8_000;

function dotColorFor(kind: DigestSignalKind): string {
  switch (kind) {
    case "completed":
    case "active":
      return "var(--green)";
    case "stuck":
      return "var(--amber)";
    case "focused":
    case "pinned":
      return "var(--text-muted)";
  }
}

function labelFor(kind: DigestSignalKind, t: ReturnType<typeof useT>): string {
  switch (kind) {
    case "completed":
      return t["digest.kind.completed"];
    case "stuck":
      return t["digest.kind.stuck"];
    case "active":
      return t["digest.kind.active"];
    case "focused":
      return t["digest.kind.focused"];
    case "pinned":
      return t["digest.kind.pinned"];
  }
}

export function StatusDigest() {
  const t = useT();
  const open = useStatusDigestStore((s) => s.open);
  const signals = useStatusDigestStore((s) => s.signals);
  const openedAt = useStatusDigestStore((s) => s.openedAt);
  const closeDigest = useStatusDigestStore((s) => s.closeDigest);

  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const rightPanelWidth = useCanvasStore((s) => s.rightPanelWidth);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeDigest();
      }
    };
    const timer = setTimeout(closeDigest, AUTO_DISMISS_MS);
    window.addEventListener("keydown", handleKey, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKey, true);
    };
  }, [open, openedAt, closeDigest]);

  if (!open) return null;

  const leftInset = leftPanelCollapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth;
  const rightInset = rightPanelCollapsed
    ? COLLAPSED_TAB_WIDTH
    : rightPanelWidth;

  const handleRowClick = (signal: DigestSignal) => {
    closeDigest();
    panToTerminal(signal.terminalId);
  };

  return (
    <div
      className="fixed pointer-events-none flex justify-center"
      style={{
        bottom: 24,
        left: leftInset,
        right: rightInset,
        zIndex: 30,
      }}
    >
      <div
        role="status"
        aria-label={t["digest.aria"]}
        className="tc-enter-fade-up tc-discovery-chip pointer-events-auto flex flex-col gap-1 rounded-2xl border px-3 py-2 backdrop-blur-sm"
        style={{ minWidth: 240, maxWidth: 380 }}
      >
        {signals.length === 0 ? (
          <div className="tc-meta px-1 py-0.5">{t["digest.empty"]}</div>
        ) : (
          signals.map((signal) => (
            <button
              key={`${signal.kind}:${signal.terminalId}`}
              type="button"
              onClick={() => handleRowClick(signal)}
              className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--text-muted)_8%,transparent)]"
              style={{ transitionDuration: "var(--duration-quick)" }}
            >
              <span
                aria-hidden
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: dotColorFor(signal.kind) }}
              />
              <span
                className="tc-eyebrow shrink-0"
                style={{ color: "var(--text-muted)", minWidth: 64 }}
              >
                {labelFor(signal.kind, t)}
              </span>
              <span
                className="truncate"
                style={{
                  color: "var(--text-primary)",
                  fontSize: "12px",
                }}
              >
                {signal.title}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
