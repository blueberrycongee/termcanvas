import { useState, useEffect, useRef, useCallback } from "react";
import { useLocaleStore } from "../stores/localeStore";
import { useThemeStore } from "../stores/themeStore";
import {
  useShortcutStore,
  formatShortcut,
  eventToShortcut,
  DEFAULT_SHORTCUTS,
  type ShortcutMap,
} from "../stores/shortcutStore";
import { useT } from "../i18n/useT";

const platform = window.termcanvas?.app.platform ?? "darwin";
const isMac = platform === "darwin";

interface Props {
  onClose: () => void;
}

type Tab = "general" | "shortcuts";

const SHORTCUT_KEYS: { key: keyof ShortcutMap; labelKey: string }[] = [
  { key: "toggleSidebar", labelKey: "shortcut_toggle_sidebar" },
  { key: "newTerminal", labelKey: "shortcut_new_terminal" },
  { key: "nextTerminal", labelKey: "shortcut_next_terminal" },
  { key: "prevTerminal", labelKey: "shortcut_prev_terminal" },
  { key: "clearFocus", labelKey: "shortcut_clear_focus" },
  { key: "spanDefault", labelKey: "shortcut_span_default" },
  { key: "spanWide", labelKey: "shortcut_span_wide" },
  { key: "spanTall", labelKey: "shortcut_span_tall" },
  { key: "spanLarge", labelKey: "shortcut_span_large" },
];

function ShortcutRow({
  label,
  value,
  isRecording,
  onStartRecord,
  conflict,
}: {
  label: string;
  value: string;
  isRecording: boolean;
  onStartRecord: () => void;
  conflict: boolean;
}) {
  const t = useT();

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[var(--border)]">
      <span className="text-[13px] text-[var(--text-primary)]">{label}</span>
      <div className="flex items-center gap-2">
        {conflict && (
          <span className="text-[11px] text-[var(--red)]">
            {t.shortcuts_conflict}
          </span>
        )}
        <button
          className={`px-3 py-1 rounded-md text-[13px] min-w-[120px] text-center transition-colors duration-150 ${
            isRecording
              ? "bg-[var(--accent)] text-white"
              : "bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]"
          }`}
          style={{ fontFamily: '"Geist Mono", monospace' }}
          onClick={onStartRecord}
        >
          {isRecording ? t.shortcuts_press_hint : formatShortcut(value, isMac)}
        </button>
      </div>
    </div>
  );
}

export function SettingsModal({ onClose }: Props) {
  const { locale, setLocale } = useLocaleStore();
  const { theme, toggleTheme } = useThemeStore();
  const { shortcuts, setShortcut, resetAll } = useShortcutStore();
  const t = useT();
  const [tab, setTab] = useState<Tab>("general");
  const [recordingKey, setRecordingKey] = useState<keyof ShortcutMap | null>(
    null,
  );
  const [conflicts, setConflicts] = useState<Set<keyof ShortcutMap>>(new Set());
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on Escape (when not recording)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (recordingKey) {
        e.preventDefault();
        e.stopPropagation();
        const shortcut = eventToShortcut(e);
        if (!shortcut) return; // modifier-only press

        // Check for conflicts
        const conflicting = Object.entries(shortcuts).find(
          ([k, v]) => k !== recordingKey && v === shortcut,
        );
        if (conflicting) {
          setConflicts(
            new Set([recordingKey, conflicting[0] as keyof ShortcutMap]),
          );
          setTimeout(() => setConflicts(new Set()), 2000);
          setRecordingKey(null);
          return;
        }

        setShortcut(recordingKey, shortcut);
        setConflicts(new Set());
        setRecordingKey(null);
        return;
      }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recordingKey, shortcuts, setShortcut, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  const toggleBtn =
    "px-3 py-1.5 rounded-md text-[13px] transition-colors duration-150";
  const activeBtn = `${toggleBtn} bg-[var(--border)] text-[var(--text-primary)]`;
  const inactiveBtn = `${toggleBtn} text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)]`;

  const tabBtn = (active: boolean) =>
    `px-4 py-2 text-[13px] transition-colors duration-150 border-b-2 ${
      active
        ? "text-[var(--text-primary)] border-[var(--accent)]"
        : "text-[var(--text-muted)] border-transparent hover:text-[var(--text-secondary)]"
    }`;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-0">
          <h2 className="text-[17px] font-medium text-[var(--text-primary)]">
            {t.settings}
          </h2>
          <button
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={onClose}
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path
                d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 px-6 mt-3 border-b border-[var(--border)]">
          <button
            className={tabBtn(tab === "general")}
            onClick={() => setTab("general")}
          >
            {t.settings_general}
          </button>
          <button
            className={tabBtn(tab === "shortcuts")}
            onClick={() => setTab("shortcuts")}
          >
            {t.settings_shortcuts}
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 min-h-[280px]">
          {tab === "general" && (
            <div className="flex flex-col gap-5">
              {/* Language */}
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {t.language}
                </span>
                <div className="flex gap-1">
                  <button
                    className={locale === "zh" ? activeBtn : inactiveBtn}
                    onClick={() => setLocale("zh")}
                  >
                    中文
                  </button>
                  <button
                    className={locale === "en" ? activeBtn : inactiveBtn}
                    onClick={() => setLocale("en")}
                  >
                    English
                  </button>
                </div>
              </div>

              {/* Theme */}
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {t.theme}
                </span>
                <div className="flex gap-1">
                  <button
                    className={theme === "dark" ? activeBtn : inactiveBtn}
                    onClick={() => theme !== "dark" && toggleTheme()}
                  >
                    {t.theme_dark}
                  </button>
                  <button
                    className={theme === "light" ? activeBtn : inactiveBtn}
                    onClick={() => theme !== "light" && toggleTheme()}
                  >
                    {t.theme_light}
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "shortcuts" && (
            <div>
              {SHORTCUT_KEYS.map(({ key, labelKey }) => (
                <ShortcutRow
                  key={key}
                  label={(t as unknown as Record<string, string>)[labelKey]}
                  value={shortcuts[key]}
                  isRecording={recordingKey === key}
                  onStartRecord={() =>
                    setRecordingKey(recordingKey === key ? null : key)
                  }
                  conflict={conflicts.has(key)}
                />
              ))}

              <div className="mt-4 flex justify-end">
                <button
                  className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors duration-150"
                  onClick={() => {
                    resetAll();
                    setConflicts(new Set());
                  }}
                >
                  {t.shortcuts_reset}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
