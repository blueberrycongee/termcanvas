import { useState, useEffect, useRef, useCallback } from "react";
import { useLocaleStore } from "../stores/localeStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import type { TerminalType } from "../types";
import {
  useShortcutStore,
  formatShortcut,
  eventToShortcut,
  DEFAULT_SHORTCUTS,
  type ShortcutMap,
} from "../stores/shortcutStore";
import { useSettingsModalStore, type SettingsTab } from "../stores/settingsModalStore";
import { useT } from "../i18n/useT";
import { FONT_REGISTRY } from "../terminal/fontRegistry";
import { loadFont } from "../terminal/fontLoader";
import { useNotificationStore } from "../stores/notificationStore";

const platform = window.termcanvas?.app.platform ?? "darwin";
const isMac = platform === "darwin";

interface Props {
  onClose: () => void;
}

type Tab = SettingsTab;

const SHORTCUT_KEYS: { key: keyof ShortcutMap; labelKey: string }[] = [
  { key: "addProject", labelKey: "shortcut_add_project" },
  { key: "cycleFocusLevel", labelKey: "shortcut_cycle_focus_level" },
  { key: "toggleRightPanel", labelKey: "shortcut_toggle_right_panel" },
  { key: "newTerminal", labelKey: "shortcut_new_terminal" },
  { key: "saveWorkspace", labelKey: "shortcut_save_workspace" },
  { key: "saveWorkspaceAs", labelKey: "shortcut_save_workspace_as" },
  { key: "renameTerminalTitle", labelKey: "shortcut_rename_terminal_title" },
  { key: "closeFocused", labelKey: "shortcut_close_focused" },
  { key: "toggleStarFocused", labelKey: "shortcut_toggle_star_focused" },
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

const AGENT_TYPES = ["claude", "codex", "kimi", "gemini", "opencode"] as const;

type ValidateResult =
  | { ok: true; resolvedPath: string; version: string | null }
  | { ok: false; error: string };

function AgentsTabContent() {
  const t = useT();
  const { cliCommands, setCli } = usePreferencesStore();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, ValidateResult | null>>({});

  // Auto-detect on mount
  useEffect(() => {
    for (const agent of AGENT_TYPES) {
      const command = cliCommands[agent]?.command ?? agent;
      setStatuses((prev) => ({ ...prev, [agent]: null }));
      window.termcanvas.cli.validateCommand(command).then((result) => {
        setStatuses((prev) => ({ ...prev, [agent]: result }));
      });
    }
  }, []);

  const handleValidate = (agent: TerminalType) => {
    const command = drafts[agent]?.trim() || cliCommands[agent]?.command || agent;
    setStatuses((prev) => ({ ...prev, [agent]: null }));
    window.termcanvas.cli.validateCommand(command).then((result) => {
      setStatuses((prev) => ({ ...prev, [agent]: result }));
    });
  };

  const handleSave = (agent: TerminalType) => {
    const command = drafts[agent]?.trim();
    if (command) {
      setCli(agent, { command, args: [] });
    } else {
      setCli(agent, null);
    }
    handleValidate(agent);
  };

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[12px] text-[var(--text-muted)] mb-2">
        {t.agent_default_hint}
      </p>
      {AGENT_TYPES.map((agent) => {
        const status = statuses[agent] ?? null;
        const saved = cliCommands[agent]?.command;
        const draft = drafts[agent] ?? saved ?? "";

        return (
          <div
            key={agent}
            className="flex items-center gap-2 py-2 border-b border-[var(--border)]"
          >
            <span className="text-[13px] text-[var(--text-primary)] w-20 shrink-0 capitalize">
              {agent}
            </span>

            <input
              type="text"
              className="flex-1 min-w-0 px-2 py-1 rounded-md text-[13px] bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              placeholder={
                status?.ok
                  ? t.agent_command_placeholder(status.resolvedPath)
                  : agent
              }
              value={draft}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [agent]: e.target.value }))
              }
              onBlur={() => handleSave(agent)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave(agent);
              }}
            />

            <button
              className="px-2 py-1 rounded-md text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--surface)] hover:bg-[var(--border)] transition-colors duration-100 shrink-0"
              onClick={() => handleValidate(agent)}
            >
              {t.agent_validate}
            </button>

            <span
              className={`text-[11px] shrink-0 min-w-[80px] text-right ${
                status === null
                  ? "text-[var(--text-muted)]"
                  : status.ok
                    ? "text-[var(--green,#4ade80)]"
                    : "text-[var(--red,#f87171)]"
              }`}
            >
              {status === null
                ? t.agent_status_checking
                : status.ok
                  ? t.agent_status_found(status.version ?? "unknown")
                  : t.agent_status_not_found}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SettingsModal({ onClose }: Props) {
  const { locale, setLocale } = useLocaleStore();
  const { animationBlur, setAnimationBlur, terminalFontSize, setTerminalFontSize, terminalFontFamily, setTerminalFontFamily, composerEnabled, setComposerEnabled, drawingEnabled, setDrawingEnabled, minimumContrastRatio, setMinimumContrastRatio } = usePreferencesStore();
  const [fontSizeDraft, setFontSizeDraft] = useState(terminalFontSize);
  const { shortcuts, setShortcut, resetAll } = useShortcutStore();
  const [downloadedFonts, setDownloadedFonts] = useState<Set<string>>(new Set());
  const [downloadingFont, setDownloadingFont] = useState<string | null>(null);
  const t = useT();
  const initialTab = useSettingsModalStore((s) => s.initialTab);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [recordingKey, setRecordingKey] = useState<keyof ShortcutMap | null>(
    null,
  );
  const [conflicts, setConflicts] = useState<Set<keyof ShortcutMap>>(new Set());
  const backdropRef = useRef<HTMLDivElement>(null);
  const [cliRegistered, setCliRegistered] = useState<boolean | null>(null);
  const [cliLoading, setCliLoading] = useState(false);

  useEffect(() => {
    window.termcanvas?.cli.isRegistered().then(setCliRegistered);
  }, []);

  useEffect(() => {
    window.termcanvas.fonts.listDownloaded().then((files) => {
      setDownloadedFonts(new Set(files));
    });
  }, []);

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
          <button
            className={tabBtn(tab === "agents")}
            onClick={() => setTab("agents")}
          >
            {t.settings_agents}
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 min-h-[280px] max-h-[60vh] overflow-y-auto">
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

              {/* Terminal font size */}
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {t.terminal_font_size}
                </span>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min="6"
                    max="24"
                    step="1"
                    value={fontSizeDraft}
                    onChange={(e) => setFontSizeDraft(Number(e.target.value))}
                    onMouseUp={() => setTerminalFontSize(fontSizeDraft)}
                    onTouchEnd={() => setTerminalFontSize(fontSizeDraft)}
                    className="w-24 accent-[var(--accent)]"
                  />
                  <span
                    className="text-[12px] text-[var(--text-muted)] w-10 text-right tabular-nums"
                    style={{ fontFamily: '"Geist Mono", monospace' }}
                  >
                    {fontSizeDraft}px
                  </span>
                </div>
              </div>

              {/* Terminal font */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {t.terminal_font}
                </span>
                <div className="flex flex-col gap-0.5 max-h-[240px] overflow-y-auto rounded-md border border-[var(--border)] p-1">
                  {FONT_REGISTRY.map((font) => {
                    const isBuiltin = font.source === "builtin";
                    const isDownloaded = downloadedFonts.has(font.fileName);
                    const isAvailable = isBuiltin || isDownloaded;
                    const isSelected = terminalFontFamily === font.id;
                    const isDownloading = downloadingFont === font.id;

                    return (
                      <div
                        key={font.id}
                        className={`flex items-center justify-between px-3 py-2 rounded-md text-left transition-colors duration-100 ${
                          isSelected
                            ? "bg-[var(--accent)]/15 text-[var(--text-primary)]"
                            : isAvailable
                              ? "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] cursor-pointer"
                              : "text-[var(--text-secondary)]"
                        }`}
                        onClick={() => {
                          if (isAvailable) setTerminalFontFamily(font.id);
                        }}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-[13px]">{font.name}</span>
                          {isAvailable && (
                            <span
                              className="text-[12px] text-[var(--text-muted)] truncate"
                              style={{ fontFamily: `${font.cssFamily}, monospace` }}
                            >
                              {"AaBbCc 0123 \u2192\u2192 {}"}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 ml-2 shrink-0">
                          {isBuiltin && (
                            <span className="text-[11px] text-[var(--text-muted)] px-1.5 py-0.5 rounded bg-[var(--surface)]">
                              {t.font_builtin}
                            </span>
                          )}
                          {!isBuiltin && isDownloaded && (
                            <span className="text-[11px] text-[var(--text-muted)] px-1.5 py-0.5 rounded bg-[var(--surface)]">
                              {t.font_downloaded}
                            </span>
                          )}
                          {!isBuiltin && !isDownloaded && !isDownloading && (
                            <button
                              className="text-[11px] text-[var(--accent)] hover:text-[var(--text-primary)] px-1.5 py-0.5 rounded bg-[var(--surface)] hover:bg-[var(--border)] transition-colors duration-100"
                              onClick={async (e) => {
                                e.stopPropagation();
                                setDownloadingFont(font.id);
                                try {
                                  const result = await window.termcanvas.fonts.download(
                                    font.url,
                                    font.fileName,
                                  );
                                  if (result.ok) {
                                    const fontsDir = await window.termcanvas.fonts.getPath();
                                    await loadFont(font, fontsDir);
                                    setDownloadedFonts((prev) => new Set([...prev, font.fileName]));
                                  } else {
                                    useNotificationStore.getState().notify(
                                      "error",
                                      `${t.font_download_failed}: ${result.error ?? font.name}`,
                                    );
                                  }
                                } catch (err) {
                                  useNotificationStore.getState().notify(
                                    "error",
                                    `${t.font_download_failed}: ${err instanceof Error ? err.message : font.name}`,
                                  );
                                }
                                setDownloadingFont(null);
                              }}
                            >
                              {t.font_download}
                            </button>
                          )}
                          {isDownloading && (
                            <span className="text-[11px] text-[var(--text-muted)] px-1.5 py-0.5 flex items-center gap-1">
                              <svg className="animate-spin h-3 w-3" viewBox="0 0 16 16" fill="none">
                                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                                <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                              {t.font_downloading}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Animation blur */}
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {t.animation_blur}
                </span>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min="0"
                    max="3"
                    step="0.1"
                    value={animationBlur}
                    onChange={(e) => setAnimationBlur(Number(e.target.value))}
                    className="w-24 accent-[var(--accent)]"
                  />
                  <span
                    className="text-[12px] text-[var(--text-muted)] w-10 text-right tabular-nums"
                    style={{ fontFamily: '"Geist Mono", monospace' }}
                  >
                    {animationBlur === 0 ? "Off" : `${animationBlur.toFixed(1)}`}
                  </span>
                </div>
              </div>

              {/* Minimum contrast ratio */}
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {t.minimum_contrast}
                </span>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min="1"
                    max="7"
                    step="0.1"
                    value={minimumContrastRatio}
                    onChange={(e) => setMinimumContrastRatio(Number(e.target.value))}
                    className="w-24 accent-[var(--accent)]"
                  />
                  <span
                    className="text-[12px] text-[var(--text-muted)] w-10 text-right tabular-nums"
                    style={{ fontFamily: '"Geist Mono", monospace' }}
                  >
                    {minimumContrastRatio <= 1 ? "Off" : `${minimumContrastRatio.toFixed(1)}`}
                  </span>
                </div>
              </div>

              {/* Composer toggle */}
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] text-[var(--text-secondary)]">
                    {t.composer_toggle}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {t.composer_toggle_desc}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    className={composerEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setComposerEnabled(true)}
                  >
                    On
                  </button>
                  <button
                    className={!composerEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setComposerEnabled(false)}
                  >
                    Off
                  </button>
                </div>
              </div>

              {/* Drawing toggle */}
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] text-[var(--text-secondary)]">
                    {t.drawing_toggle}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {t.drawing_toggle_desc}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    className={drawingEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setDrawingEnabled(true)}
                  >
                    On
                  </button>
                  <button
                    className={!drawingEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setDrawingEnabled(false)}
                  >
                    Off
                  </button>
                </div>
              </div>

              {/* CLI registration */}
              {cliRegistered !== null && (
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] text-[var(--text-secondary)]">
                      {t.cli_label}
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      termcanvas, hydra
                    </span>
                  </div>
                  {cliRegistered ? (
                    <span className={`${toggleBtn} bg-[var(--border)] text-[var(--text-muted)] cursor-default`}>
                      {t.cli_registered}
                    </span>
                  ) : (
                    <button
                      className={inactiveBtn}
                      disabled={cliLoading}
                      onClick={async () => {
                        setCliLoading(true);
                        const ok = await window.termcanvas.cli.register();
                        if (ok) setCliRegistered(true);
                        setCliLoading(false);
                      }}
                    >
                      {cliLoading ? t.cli_registering : t.cli_not_registered}
                    </button>
                  )}
                </div>
              )}
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

          {tab === "agents" && <AgentsTabContent />}
        </div>
      </div>
    </div>
  );
}
