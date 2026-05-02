import { useState } from "react";
import { useThemeStore } from "../stores/themeStore";
import { useUpdaterStore } from "../stores/updaterStore";
import { useSettingsModalStore } from "../stores/settingsModalStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useHubStore } from "../stores/hubStore";
import { SettingsModal } from "../components/SettingsModal";
import { UpdateModal } from "../components/UpdateModal";
import { useT } from "../i18n/useT";
import { getWorkspaceBaseName } from "../titleHelper";
import { formatShortcut, useShortcutStore } from "../stores/shortcutStore";

export { TOOLBAR_HEIGHT } from "./toolbarHeight";

const platform = window.termcanvas?.app.platform ?? "darwin";
const isMac = platform === "darwin";
const isWin = platform === "win32";

const MAC_STOPLIGHT_GUTTER = 72;
const WIN_CAPTION_GUTTER = 140;

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const ICON_BUTTON_TRANSITION = {
  transition:
    "background-color var(--duration-quick) var(--ease-out-soft), color var(--duration-quick) var(--ease-out-soft), transform var(--duration-instant) var(--ease-out-soft)",
} as React.CSSProperties;

const iconButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-hover)] motion-reduce:transition-none motion-reduce:hover:transform-none";

export function Toolbar() {
  const { theme, toggleTheme } = useThemeStore();
  const t = useT();
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const dirty = useWorkspaceStore((s) => s.dirty);
  const updateStatus = useUpdaterStore((s) => s.status);
  const showSettings = useSettingsModalStore((s) => s.open);
  const openSettings = useSettingsModalStore((s) => s.openSettings);
  const closeSettings = useSettingsModalStore((s) => s.closeSettings);
  const [showUpdate, setShowUpdate] = useState(false);

  const hubOpen = useHubStore((s) => s.open);
  const toggleHub = useHubStore((s) => s.toggleHub);
  const hubShortcut = useShortcutStore((s) => s.shortcuts.toggleHub);
  const hubChord = formatShortcut(hubShortcut, isMac);
  const hubLabel = t["hub.toolbarLabel"](hubChord);

  const workspaceName =
    getWorkspaceBaseName(workspacePath) ?? t.toolbar_untitled_workspace;

  return (
    <>
      <div
        className="fixed top-0 left-0 right-0 z-50 flex h-11 items-center overflow-hidden border-b border-[var(--border)]"
        style={
          {
            paddingLeft: isMac ? MAC_STOPLIGHT_GUTTER : 16,
            paddingRight: isWin ? WIN_CAPTION_GUTTER : 16,
            WebkitAppRegion: "drag",
            background:
              "linear-gradient(to bottom, var(--bg) 0%, color-mix(in srgb, var(--bg) 88%, var(--surface) 12%) 100%)",
          } as React.CSSProperties
        }
      >
        {/* Center column carries the workspace identity. The flex-1
            wrapper lets the title visually center between the platform
            gutters; truncation falls back to ellipsis when the project
            path is long. */}
        <div className="flex flex-1 min-w-0 items-center justify-center px-3">
          <div
            className="flex min-w-0 items-center gap-2"
            title={workspacePath ?? workspaceName}
          >
            {dirty && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-secondary)]"
                style={{ opacity: 0.7 }}
              />
            )}
            <span className="tc-ui min-w-0 truncate">{workspaceName}</span>
          </div>
        </div>

        <div
          className="relative z-10 flex shrink-0 items-center gap-0.5"
          style={noDrag}
        >
          {updateStatus !== "idle" && (
            <UpdateStatusButton
              status={updateStatus}
              t={t}
              onClick={() => setShowUpdate(true)}
            />
          )}

          <button
            type="button"
            data-hub-trigger="true"
            data-active={hubOpen ? "true" : "false"}
            className={iconButtonClass}
            style={{
              ...ICON_BUTTON_TRANSITION,
              color: hubOpen ? "var(--text-primary)" : undefined,
              backgroundColor: hubOpen ? "var(--surface-hover)" : undefined,
            }}
            onClick={toggleHub}
            title={hubLabel}
            aria-label={hubLabel}
            aria-pressed={hubOpen}
          >
            <HubIcon />
          </button>

          <button
            type="button"
            className={iconButtonClass}
            style={ICON_BUTTON_TRANSITION}
            onClick={toggleTheme}
            title={theme === "dark" ? t.switch_to_light : t.switch_to_dark}
            aria-label={theme === "dark" ? t.switch_to_light : t.switch_to_dark}
          >
            {/* Key on theme triggers the entrance pop on swap so the
                glyph change reads as a deliberate state hand-off, not
                an instant flicker. */}
            <span
              key={theme}
              className="tc-enter-pop inline-flex motion-reduce:animate-none"
              aria-hidden="true"
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </span>
          </button>

          <button
            type="button"
            className={iconButtonClass}
            style={ICON_BUTTON_TRANSITION}
            onClick={() => openSettings()}
            title={t.settings}
            aria-label={t.settings}
          >
            <SettingsIcon />
          </button>

          <button
            type="button"
            className={iconButtonClass}
            style={ICON_BUTTON_TRANSITION}
            onClick={() =>
              window.open(
                "https://github.com/blueberrycongee/termcanvas",
                "_blank",
              )
            }
            title="Star on GitHub"
            aria-label="Star on GitHub"
          >
            <StarIcon />
          </button>
        </div>
      </div>

      {showSettings && <SettingsModal onClose={closeSettings} />}
      {showUpdate && <UpdateModal onClose={() => setShowUpdate(false)} />}
    </>
  );
}

type UpdateStatus = ReturnType<typeof useUpdaterStore.getState>["status"];

function UpdateStatusButton({
  status,
  t,
  onClick,
}: {
  status: UpdateStatus;
  t: ReturnType<typeof useT>;
  onClick: () => void;
}) {
  const label =
    status === "downloading"
      ? t.update_downloading
      : status === "ready"
        ? t.update_ready
        : status === "error"
          ? t.update_error
          : t.update_checking;

  return (
    <button
      type="button"
      // Pop on every status transition so a state change reads as
      // an event, not a silent swap. Keyed on status to remount.
      key={status}
      className={`${iconButtonClass} tc-enter-pop relative motion-reduce:animate-none`}
      style={ICON_BUTTON_TRANSITION}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {status === "downloading" ? (
        <ArrowDownIcon className="motion-safe:animate-bounce" />
      ) : status === "ready" ? (
        <>
          <ArrowUpIcon />
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-[var(--green)] ring-2 ring-[var(--bg)]"
          />
        </>
      ) : status === "error" ? (
        <WarningIcon style={{ color: "var(--amber)" }} />
      ) : (
        <SpinnerIcon className="motion-safe:animate-spin" />
      )}
    </button>
  );
}

function HubIcon() {
  // Three rows of stacked bars — a "queue / activity feed" mark, hinting
  // that the surface aggregates many signals into one column. Stroke-only
  // so it inherits the icon button's color tokens.
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2 3.5h10M2 7h7M2 10.5h10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="11" cy="7" r="1.1" fill="currentColor" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M2.93 11.07l1.06-1.06M10.01 3.99l1.06-1.06"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M12.5 8.5a5.5 5.5 0 0 1-7-7 5.5 5.5 0 1 0 7 7Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M5.7 1h2.6l.4 1.7a4.5 4.5 0 0 1 1.1.6l1.7-.5 1.3 2.2-1.3 1.2a4.5 4.5 0 0 1 0 1.2l1.3 1.2-1.3 2.3-1.7-.6a4.5 4.5 0 0 1-1.1.7L8.3 13H5.7l-.4-1.7a4.5 4.5 0 0 1-1.1-.7l-1.7.6-1.3-2.3 1.3-1.2a4.5 4.5 0 0 1 0-1.2L1.2 5.3l1.3-2.2 1.7.5a4.5 4.5 0 0 1 1.1-.6L5.7 1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="7" r="1.8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 12V4M4 6.5L7 3.5 10 6.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 2h8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowDownIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={className}
    >
      <path
        d="M7 2v8M4 7.5L7 10.5 10 7.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 12h8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WarningIcon({ style }: { style?: React.CSSProperties }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={style}>
      <path
        d="M7 2L1.5 12h11L7 2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M7 6v3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="7" cy="10.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={className}
    >
      <path
        d="M7 1.5A5.5 5.5 0 1 1 1.5 7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 1l1.76 3.57L12.5 5.27 10.25 8.14l.43 3.86L7 10.73l-3.68 1.27.43-3.86L1.5 5.27l3.74-.7L7 1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
