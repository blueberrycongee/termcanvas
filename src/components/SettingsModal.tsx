import { useState, useEffect, useRef, useCallback } from "react";
import { useLocaleStore } from "../stores/localeStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { PROVIDER_PRESETS, getPreset } from "../agentProviders";
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
import { useUpdaterStore } from "../stores/updaterStore";

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
  { key: "toggleUsageOverlay", labelKey: "shortcut_toggle_usage_overlay" },
  { key: "toggleSessionsOverlay", labelKey: "shortcut_toggle_sessions_overlay" },
  { key: "newTerminal", labelKey: "shortcut_new_terminal" },
  { key: "saveWorkspace", labelKey: "shortcut_save_workspace" },
  { key: "saveWorkspaceAs", labelKey: "shortcut_save_workspace_as" },
  { key: "renameTerminalTitle", labelKey: "shortcut_rename_terminal_title" },
  { key: "closeFocused", labelKey: "shortcut_close_focused" },
  { key: "toggleStarFocused", labelKey: "shortcut_toggle_star_focused" },
  { key: "nextTerminal", labelKey: "shortcut_next_terminal" },
  { key: "prevTerminal", labelKey: "shortcut_prev_terminal" },
  { key: "clearFocus", labelKey: "shortcut_clear_focus" },
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

function UpdateCheckButton() {
  const t = useT();
  const { status, downloadPercent, errorMessage } = useUpdaterStore();
  const [upToDate, setUpToDate] = useState(false);
  const updateStatusClass =
    "inline-flex min-w-[132px] justify-end text-right text-[11px]";

  const handleCheck = useCallback(async () => {
    setUpToDate(false);
    useUpdaterStore.setState({ status: "checking", errorMessage: null });
    await window.termcanvas.updater.check();
    const current = useUpdaterStore.getState().status;
    if (current === "checking") {
      useUpdaterStore.setState({ status: "idle" });
      setUpToDate(true);
      setTimeout(() => setUpToDate(false), 3000);
    }
  }, []);

  const handleInstall = useCallback(() => {
    useUpdaterStore.getState().requestRestartOnClose();
    window.termcanvas.app.requestClose();
  }, []);

  if (upToDate) {
    return (
      <span className={`${updateStatusClass} text-[var(--text-muted)]`} aria-live="polite">
        {t.update_up_to_date}
      </span>
    );
  }

  if (status === "checking") {
    return (
      <span className={`${updateStatusClass} text-[var(--text-muted)]`} aria-live="polite">
        {t.update_checking_short}
      </span>
    );
  }

  if (status === "downloading") {
    return (
      <span className={`${updateStatusClass} text-[var(--text-muted)]`} aria-live="polite">
        {t.update_downloading_short(downloadPercent)}
      </span>
    );
  }

  if (status === "ready") {
    return (
      <button
        className={`${updateStatusClass} text-[var(--accent)] hover:underline`}
        onClick={handleInstall}
      >
        {t.update_restart_short}
      </button>
    );
  }

  if (status === "error") {
    return (
      <button
        className={`${updateStatusClass} text-[var(--amber)] hover:text-[var(--text-secondary)] transition-colors`}
        onClick={handleCheck}
        title={errorMessage ?? t.update_error}
      >
        {t.update_error}
      </button>
    );
  }

  return (
    <button
      className={`${updateStatusClass} text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors`}
      onClick={handleCheck}
    >
      {t.update_check}
    </button>
  );
}

const AGENT_TYPES = ["claude", "codex", "kimi", "gemini", "opencode", "wuu"] as const;

type ValidateResult =
  | { ok: true; resolvedPath: string; version: string | null }
  | { ok: false; error: string };

function AgentsTabContent() {
  const t = useT();
  const { cliCommands, setCli } = usePreferencesStore();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, ValidateResult | null>>({});

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
              className={`text-[11px] shrink-0 min-w-[120px] text-right ${
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

function ProviderDropdown({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = PROVIDER_PRESETS.find((p) => p.id === value) ?? PROVIDER_PRESETS[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative w-[200px]">
      <button
        className="w-full flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none transition-colors duration-150 hover:border-[var(--accent)]"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current.name}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
          <path d="M2 3.5L5 6.5L8 3.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-full max-h-52 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg z-20">
          {PROVIDER_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors duration-100 ${
                p.id === value
                  ? "bg-[var(--border)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              }`}
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsModal({ onClose }: Props) {
  const { locale, setLocale } = useLocaleStore();
  const {
    animationBlur,
    setAnimationBlur,
    terminalFontSize,
    setTerminalFontSize,
    terminalFontFamily,
    setTerminalFontFamily,
    terminalRenderer,
    setTerminalRenderer,
    composerEnabled,
    setComposerEnabled,
    drawingEnabled,
    setDrawingEnabled,
    browserEnabled,
    setBrowserEnabled,
    summaryEnabled,
    setSummaryEnabled,
    globalSearchEnabled,
    setGlobalSearchEnabled,
    petEnabled,
    setPetEnabled,
    completionGlowEnabled,
    setCompletionGlowEnabled,
    summaryCli,
    setSummaryCli,
    minimumContrastRatio,
    setMinimumContrastRatio,
    agentConfig,
    patchAgentConfig,
    setAgentConfig,
  } = usePreferencesStore();
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
  const [cliPendingAction, setCliPendingAction] = useState<"register" | "unregister" | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    window.termcanvas?.cli.isRegistered().then(setCliRegistered);
  }, []);

  useEffect(() => {
    window.termcanvas?.updater.getVersion().then(setAppVersion).catch(() => {
      setAppVersion(null);
    });
  }, []);

  useEffect(() => {
    window.termcanvas?.fonts.listDownloaded().then((files) => {
      setDownloadedFonts(new Set(files));
    });
  }, []);

  const effectiveCliRegistered =
    cliPendingAction === "register"
      ? true
      : cliPendingAction === "unregister"
        ? false
        : cliRegistered;

  const cliBusyLabel =
    cliPendingAction === "register"
      ? t.cli_registering
      : cliPendingAction === "unregister"
        ? t.cli_unregistering
        : null;

  const cliStatusText =
    effectiveCliRegistered
      ? t.cli_registered
      : t.cli_not_registered;

  const handleCliIntegrationToggle = useCallback(
    async (nextEnabled: boolean) => {
      setCliLoading(true);
      setCliPendingAction(nextEnabled ? "register" : "unregister");

      try {
        if (nextEnabled) {
          const result = await window.termcanvas.cli.register();
          if (!result.ok) {
            useNotificationStore
              .getState()
              .notify("error", t.cli_register_failed);
            return;
          }
          if (!result.skillInstalled) {
            // CLI registered but skill injection failed — agent sessions
            // started through hydra may miss hydra-specific guidance. Surface
            // it instead of silently succeeding.
            useNotificationStore
              .getState()
              .notify("warn", t.cli_register_skill_failed);
          }
          setCliRegistered(true);
        } else {
          const ok = await window.termcanvas.cli.unregister();
          if (!ok) {
            useNotificationStore
              .getState()
              .notify("error", t.cli_unregister_failed);
            return;
          }
          setCliRegistered(false);
        }
      } finally {
        setCliPendingAction(null);
        setCliLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (recordingKey) {
        e.preventDefault();
        e.stopPropagation();
        const shortcut = eventToShortcut(e);
        if (!shortcut) return; // modifier-only press

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
    "inline-flex min-w-[56px] justify-center px-3 py-1.5 rounded-md text-[13px] transition-colors duration-150";
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

        <div className="flex gap-0 px-6 mt-3 border-b border-[var(--border)] overflow-x-auto">
          <button
            className={tabBtn(tab === "general")}
            onClick={() => setTab("general")}
          >
            {t.settings_general}
          </button>
          <button
            className={tabBtn(tab === "appearance")}
            onClick={() => setTab("appearance")}
          >
            {t.settings_appearance}
          </button>
          <button
            className={tabBtn(tab === "features")}
            onClick={() => setTab("features")}
          >
            {t.settings_features}
          </button>
          <button
            className={tabBtn(tab === "agent")}
            onClick={() => setTab("agent")}
          >
            {t.settings_agent}
          </button>
          <button
            className={tabBtn(tab === "shortcuts")}
            onClick={() => setTab("shortcuts")}
          >
            {t.settings_shortcuts}
          </button>
        </div>

        <div className="px-6 py-5 min-h-[280px] max-h-[60vh] overflow-y-auto flex flex-col">
          {tab === "general" && (
            <div className="flex flex-col gap-5 flex-1">
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

              {cliRegistered !== null && (
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] text-[var(--text-secondary)]">
                      {t.cli_label}
                    </span>
                    <div
                      className="flex items-center gap-2 text-[11px]"
                      aria-live="polite"
                    >
                      <span className="text-[var(--text-muted)]">
                        {cliStatusText}
                      </span>
                      <span
                        className={`inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent)] transition-opacity duration-150 motion-safe:animate-pulse ${
                          cliBusyLabel ? "opacity-100" : "opacity-0"
                        }`}
                        aria-label={cliBusyLabel ?? undefined}
                        title={cliBusyLabel ?? undefined}
                      />
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      className={effectiveCliRegistered ? activeBtn : inactiveBtn}
                      disabled={cliLoading || effectiveCliRegistered === true}
                      onClick={() => void handleCliIntegrationToggle(true)}
                    >
                      {t.setting_on}
                    </button>
                    <button
                      className={!effectiveCliRegistered ? activeBtn : inactiveBtn}
                      disabled={cliLoading || effectiveCliRegistered === false}
                      onClick={() => void handleCliIntegrationToggle(false)}
                    >
                      {t.setting_off}
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-auto flex items-center justify-between border-t border-[var(--border)] pt-4">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--text-muted)]">
                    {t.settings_version}
                  </span>
                  <span
                    className="rounded-md bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
                    style={{ fontFamily: '"Geist Mono", monospace' }}
                  >
                    v{appVersion ?? "unknown"}
                  </span>
                </div>
                <UpdateCheckButton />
              </div>
            </div>
          )}

          {tab === "appearance" && (
            <div className="flex flex-col gap-5">
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
                    const fontBadgeClass =
                      "inline-flex min-w-[88px] justify-center text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface)]";

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
                            <span className={`${fontBadgeClass} text-[var(--text-muted)]`}>
                              {t.font_builtin}
                            </span>
                          )}
                          {!isBuiltin && isDownloaded && (
                            <span className={`${fontBadgeClass} text-[var(--text-muted)]`}>
                              {t.font_downloaded}
                            </span>
                          )}
                          {!isBuiltin && !isDownloaded && !isDownloading && (
                            <button
                              className={`${fontBadgeClass} text-[var(--accent)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] transition-colors duration-100`}
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
                            <span className={`${fontBadgeClass} text-[var(--text-muted)] flex items-center gap-1`} aria-live="polite">
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

              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] text-[var(--text-secondary)]">
                    {t.terminal_renderer}
                  </span>
                  <span className="max-w-[320px] text-[12px] leading-5 text-[var(--text-muted)]">
                    {t.terminal_renderer_desc}
                  </span>
                </div>
                <div className="inline-flex shrink-0 rounded-md border border-[var(--border)] p-0.5">
                  {(["webgl", "dom"] as const).map((mode) => {
                    const selected = terminalRenderer === mode;
                    return (
                      <button
                        key={mode}
                        className={`rounded px-2.5 py-1 text-[12px] transition-colors duration-100 ${
                          selected
                            ? "bg-[var(--accent)]/15 text-[var(--text-primary)]"
                            : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                        }`}
                        onClick={() => setTerminalRenderer(mode)}
                      >
                        {mode === "dom"
                          ? t.terminal_renderer_dom
                          : t.terminal_renderer_webgl}
                      </button>
                    );
                  })}
                </div>
              </div>

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
                    {animationBlur === 0 ? t.setting_off : `${animationBlur.toFixed(1)}`}
                  </span>
                </div>
              </div>

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
                    {minimumContrastRatio <= 1 ? t.setting_off : `${minimumContrastRatio.toFixed(1)}`}
                  </span>
                </div>
              </div>
            </div>
          )}

          {tab === "features" && (
            <div className="flex flex-col gap-5">
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
                    {t.setting_on}
                  </button>
                  <button
                    className={!composerEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setComposerEnabled(false)}
                  >
                    {t.setting_off}
                  </button>
                </div>
              </div>

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
                    {t.setting_on}
                  </button>
                  <button
                    className={!drawingEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setDrawingEnabled(false)}
                  >
                    {t.setting_off}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] text-[var(--text-secondary)]">
                    {t.browser_toggle}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {t.browser_toggle_desc}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    className={browserEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setBrowserEnabled(true)}
                  >
                    {t.setting_on}
                  </button>
                  <button
                    className={!browserEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setBrowserEnabled(false)}
                  >
                    {t.setting_off}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] text-[var(--text-secondary)]">
                    {t.summary_toggle}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {t.summary_toggle_desc}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    className={summaryEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setSummaryEnabled(true)}
                  >
                    {t.setting_on}
                  </button>
                  <button
                    className={!summaryEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setSummaryEnabled(false)}
                  >
                    {t.setting_off}
                  </button>
                </div>
              </div>

              {summaryEnabled && (
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] text-[var(--text-secondary)]">
                      {t.summary_cli_label}
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      {t.summary_cli_desc}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      className={summaryCli === "claude" ? activeBtn : inactiveBtn}
                      onClick={() => setSummaryCli("claude")}
                    >
                      Claude
                    </button>
                    <button
                      className={summaryCli === "codex" ? activeBtn : inactiveBtn}
                      onClick={() => setSummaryCli("codex")}
                    >
                      Codex
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] text-[var(--text-secondary)]">
                    {t.global_search_toggle}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {t.global_search_toggle_desc}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    className={globalSearchEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setGlobalSearchEnabled(true)}
                  >
                    {t.setting_on}
                  </button>
                  <button
                    className={!globalSearchEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setGlobalSearchEnabled(false)}
                  >
                    {t.setting_off}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] text-[var(--text-secondary)]">
                    {t.pet_toggle}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {t.pet_toggle_desc}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    className={petEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setPetEnabled(true)}
                  >
                    {t.setting_on}
                  </button>
                  <button
                    className={!petEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setPetEnabled(false)}
                  >
                    {t.setting_off}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] text-[var(--text-secondary)]">
                    {t.completion_glow_toggle}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {t.completion_glow_toggle_desc}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    className={completionGlowEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setCompletionGlowEnabled(true)}
                  >
                    {t.setting_on}
                  </button>
                  <button
                    className={!completionGlowEnabled ? activeBtn : inactiveBtn}
                    onClick={() => setCompletionGlowEnabled(false)}
                  >
                    {t.setting_off}
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "agent" && (
            <div className="flex flex-col gap-5">
              <div
                className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)] font-medium"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {t.settings_section_agent_api}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {t.agent_provider}
                </span>
                <ProviderDropdown
                  value={agentConfig.id}
                  onChange={(presetId) => {
                    const preset = getPreset(presetId);
                    if (preset) {
                      setAgentConfig({
                        id: preset.id,
                        name: preset.name,
                        type: preset.type,
                        baseURL: preset.baseURL,
                        apiKey: agentConfig.id === preset.id ? agentConfig.apiKey : "",
                        model: preset.defaultModel,
                      });
                    }
                  }}
                />
              </div>
              {agentConfig.id === "custom" && (
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-[var(--text-secondary)]">
                    {t.agent_format}
                  </span>
                  <div className="flex gap-1">
                    {(["openai", "anthropic"] as const).map((t) => (
                      <button
                        key={t}
                        className={agentConfig.type === t ? activeBtn : inactiveBtn}
                        onClick={() => patchAgentConfig({ type: t })}
                      >
                        {t === "openai" ? "OpenAI" : "Anthropic"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {t.agent_base_url}
                </span>
                <input
                  type="text"
                  value={agentConfig.baseURL}
                  onChange={(e) => patchAgentConfig({ baseURL: e.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="w-[200px] rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent)]"
                  style={{ fontFamily: '"Geist Mono", monospace' }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {t.agent_api_key}
                </span>
                <input
                  type="password"
                  value={agentConfig.apiKey}
                  onChange={(e) => patchAgentConfig({ apiKey: e.target.value })}
                  placeholder={getPreset(agentConfig.id)?.keyPlaceholder ?? "..."}
                  className="w-[200px] rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent)]"
                  style={{ fontFamily: '"Geist Mono", monospace' }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {t.agent_model}
                </span>
                <input
                  type="text"
                  value={agentConfig.model}
                  onChange={(e) => patchAgentConfig({ model: e.target.value })}
                  placeholder={getPreset(agentConfig.id)?.defaultModel ?? ""}
                  className="w-[200px] rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent)]"
                  style={{ fontFamily: '"Geist Mono", monospace' }}
                />
              </div>

              <div
                className="mt-2 border-t border-[var(--border)] pt-5 text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)] font-medium"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {t.settings_section_agent_cli}
              </div>

              <AgentsTabContent />
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
