import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useLocaleStore } from "../stores/localeStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { PROVIDER_PRESETS, getPreset } from "../agentProviders";
import type { TerminalType } from "../types";
import {
  useShortcutStore,
  formatShortcut,
  eventToShortcut,
  type ShortcutMap,
} from "../stores/shortcutStore";
import { useSettingsModalStore, type SettingsTab } from "../stores/settingsModalStore";
import { useT } from "../i18n/useT";
import { FONT_REGISTRY } from "../terminal/fontRegistry";
import { loadFont } from "../terminal/fontLoader";
import { useNotificationStore } from "../stores/notificationStore";
import { useUpdaterStore } from "../stores/updaterStore";
import { useComputerUseStore } from "../stores/computerUseStore";

const platform = window.termcanvas?.app.platform ?? "darwin";
const isMac = platform === "darwin";

const MONO_STYLE = { fontFamily: '"Geist Mono", monospace' } as const;

interface Props {
  onClose: () => void;
}

type Tab = SettingsTab;

// Shortcut groups make the keybinding list scannable instead of an
// undifferentiated stack of fifteen rows. Order within a group is by
// frequency (most-used first); group order itself goes from broad
// (workspace, navigation) to narrow (overlays).
const SHORTCUT_GROUPS: Array<{
  eyebrowKey: string;
  items: { key: keyof ShortcutMap; labelKey: string }[];
}> = [
  {
    eyebrowKey: "settings_shortcut_group_workspace",
    items: [
      { key: "addProject", labelKey: "shortcut_add_project" },
      { key: "saveWorkspace", labelKey: "shortcut_save_workspace" },
      { key: "saveWorkspaceAs", labelKey: "shortcut_save_workspace_as" },
    ],
  },
  {
    eyebrowKey: "settings_shortcut_group_navigation",
    items: [
      { key: "cycleFocusLevel", labelKey: "shortcut_cycle_focus_level" },
      { key: "nextTerminal", labelKey: "shortcut_next_terminal" },
      { key: "prevTerminal", labelKey: "shortcut_prev_terminal" },
      { key: "clearFocus", labelKey: "shortcut_clear_focus" },
    ],
  },
  {
    eyebrowKey: "settings_shortcut_group_terminal",
    items: [
      { key: "newTerminal", labelKey: "shortcut_new_terminal" },
      { key: "renameTerminalTitle", labelKey: "shortcut_rename_terminal_title" },
      { key: "closeFocused", labelKey: "shortcut_close_focused" },
      { key: "toggleStarFocused", labelKey: "shortcut_toggle_star_focused" },
    ],
  },
  {
    eyebrowKey: "settings_shortcut_group_panels",
    items: [
      { key: "toggleRightPanel", labelKey: "shortcut_toggle_right_panel" },
      { key: "toggleUsageOverlay", labelKey: "shortcut_toggle_usage_overlay" },
      { key: "toggleSessionsOverlay", labelKey: "shortcut_toggle_sessions_overlay" },
    ],
  },
];

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="tc-eyebrow" style={MONO_STYLE}>
      {children}
    </div>
  );
}

// One settings row: label (+ optional description) on the left, control
// on the right. Items inherit the gap from the section, so this never
// owns vertical spacing — keeps every section's rhythm consistent.
function SettingsRow({
  label,
  description,
  children,
  align = "center",
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={`flex justify-between gap-6 ${
        align === "start" ? "items-start" : "items-center"
      }`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="tc-body-sm text-[var(--text-primary)]">{label}</span>
        {description && (
          <span className="tc-meta">{description}</span>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function OnOffSegment({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: { on?: boolean; off?: boolean };
}) {
  const t = useT();
  const base =
    "inline-flex min-w-[52px] justify-center px-3 py-1 text-[13px] rounded-md transition-colors duration-150 disabled:cursor-not-allowed";
  const active = "bg-[var(--accent-soft)] text-[var(--text-primary)]";
  const inactive =
    "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]";
  return (
    <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface)]/40 p-0.5">
      <button
        type="button"
        className={`${base} ${value ? active : inactive}`}
        onClick={() => onChange(true)}
        disabled={disabled?.on}
      >
        {t.setting_on}
      </button>
      <button
        type="button"
        className={`${base} ${!value ? active : inactive}`}
        onClick={() => onChange(false)}
        disabled={disabled?.off}
      >
        {t.setting_off}
      </button>
    </div>
  );
}

function ChoiceSegment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface)]/40 p-0.5">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`min-w-[64px] px-3 py-1 text-[13px] rounded-md transition-colors duration-150 ${
              selected
                ? "bg-[var(--accent-soft)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
            }`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  width = 220,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  width?: number;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...MONO_STYLE, width }}
      className="rounded-md border border-[var(--border)] bg-[var(--surface)]/60 px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none transition-colors duration-150 focus:border-[var(--accent)] focus:bg-[var(--surface)]"
    />
  );
}

function SliderControl({
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (next: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-32 accent-[var(--accent)]"
      />
      <span
        className="w-12 text-right text-[12px] text-[var(--text-metadata)] tabular-nums"
        style={MONO_STYLE}
      >
        {format(value)}
      </span>
    </div>
  );
}

function ShortcutChip({
  value,
  isRecording,
  onClick,
  conflict,
}: {
  value: string;
  isRecording: boolean;
  onClick: () => void;
  conflict: boolean;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      {conflict && (
        <span className="text-[11px] text-[var(--red)]">{t.shortcuts_conflict}</span>
      )}
      <button
        type="button"
        className={`tc-kbd min-w-[120px] justify-center ${
          isRecording
            ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]"
            : ""
        }`}
        onClick={onClick}
      >
        {isRecording ? t.shortcuts_press_hint : formatShortcut(value, isMac)}
      </button>
    </div>
  );
}

function UpdateStatusLine({ appVersion }: { appVersion: string | null }) {
  const t = useT();
  const { status, downloadPercent, errorMessage } = useUpdaterStore();
  const [upToDate, setUpToDate] = useState(false);

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
    window.termcanvas.updater.install();
  }, []);

  let statusEl: ReactNode = (
    <button
      type="button"
      className="text-[11px] text-[var(--text-metadata)] hover:text-[var(--text-primary)] transition-colors duration-150"
      onClick={handleCheck}
    >
      {t.update_check}
    </button>
  );
  if (upToDate) {
    statusEl = (
      <span className="text-[11px] text-[var(--text-muted)]" aria-live="polite">
        {t.update_up_to_date}
      </span>
    );
  } else if (status === "checking") {
    statusEl = (
      <span className="text-[11px] text-[var(--text-muted)]" aria-live="polite">
        {t.update_checking_short}
      </span>
    );
  } else if (status === "downloading") {
    statusEl = (
      <span className="text-[11px] text-[var(--text-muted)]" aria-live="polite">
        {t.update_downloading_short(downloadPercent)}
      </span>
    );
  } else if (status === "ready") {
    statusEl = (
      <button
        type="button"
        className="text-[11px] text-[var(--accent)] hover:underline"
        onClick={handleInstall}
      >
        {t.update_restart_short}
      </button>
    );
  } else if (status === "error") {
    statusEl = (
      <button
        type="button"
        className="text-[11px] text-[var(--amber)] hover:text-[var(--text-primary)] transition-colors"
        onClick={handleCheck}
        title={errorMessage ?? t.update_error}
      >
        {t.update_error}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 px-3 pb-3 pt-3 border-t border-[var(--border)]">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="tc-eyebrow" style={MONO_STYLE}>
          {t.settings_version}
        </span>
        <span
          className="text-[12px] text-[var(--text-metadata)] tabular-nums truncate"
          style={MONO_STYLE}
        >
          v{appVersion ?? "unknown"}
        </span>
      </div>
      {statusEl}
    </div>
  );
}

const AGENT_TYPES = ["claude", "codex", "kimi", "gemini", "opencode", "wuu"] as const;

type ValidateResult =
  | { ok: true; resolvedPath: string; version: string | null }
  | { ok: false; error: string };

function CliToolsList() {
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
    <div className="flex flex-col">
      <p className="tc-meta mb-3">{t.agent_default_hint}</p>
      <div className="overflow-hidden rounded-md border border-[var(--border)]">
        {AGENT_TYPES.map((agent, idx) => {
          const status = statuses[agent] ?? null;
          const saved = cliCommands[agent]?.command;
          const draft = drafts[agent] ?? saved ?? "";
          return (
            <div
              key={agent}
              className={`flex items-center gap-3 px-3 py-2 ${
                idx > 0 ? "border-t border-[var(--border)]" : ""
              }`}
            >
              <span
                className="w-16 shrink-0 text-[12px] text-[var(--text-secondary)] capitalize tracking-tight"
                style={MONO_STYLE}
              >
                {agent}
              </span>

              <input
                type="text"
                className="flex-1 min-w-0 px-2 py-1 rounded-md text-[12px] bg-[var(--surface)]/60 border border-transparent text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors duration-150"
                style={MONO_STYLE}
                placeholder={
                  status?.ok ? t.agent_command_placeholder(status.resolvedPath) : agent
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
                type="button"
                className="px-2 py-1 rounded-md text-[11px] text-[var(--text-metadata)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-150 shrink-0"
                onClick={() => handleValidate(agent)}
              >
                {t.agent_validate}
              </button>

              <span
                className={`flex items-center gap-1.5 shrink-0 min-w-[100px] justify-end text-[11px] ${
                  status === null
                    ? "text-[var(--text-muted)]"
                    : status.ok
                      ? "text-[var(--green)]"
                      : "text-[var(--text-muted)]"
                }`}
                style={MONO_STYLE}
              >
                <span
                  className={`inline-flex h-1.5 w-1.5 rounded-full shrink-0 ${
                    status === null
                      ? "bg-[var(--text-faint)] animate-pulse"
                      : status.ok
                        ? "bg-[var(--green)]"
                        : "bg-[var(--text-faint)]"
                  }`}
                />
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
    <div ref={ref} className="relative w-[220px]">
      <button
        type="button"
        className="w-full flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface)]/60 px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition-colors duration-150 hover:border-[var(--border-hover)] focus:border-[var(--accent)]"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current.name}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 3.5L5 6.5L8 3.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-full max-h-52 overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg)] shadow-lg z-20 tc-enter-fade-quick">
          {PROVIDER_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors duration-100 ${
                p.id === value
                  ? "bg-[var(--accent-soft)] text-[var(--text-primary)]"
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

function ComputerUseSection() {
  const t = useT();
  const {
    enabled,
    helperRunning,
    accessibilityGranted,
    screenRecordingGranted,
    error,
    loading,
    fetchStatus,
    enable: cuEnable,
    disable: cuDisable,
    stop: cuStop,
    openPermissions,
  } = useComputerUseStore();

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (!window.termcanvas?.computerUse?.onStateChanged) return;
    const unsub = window.termcanvas.computerUse.onStateChanged((state) => {
      useComputerUseStore.setState({
        enabled: state.enabled,
        helperRunning: state.helperRunning,
        accessibilityGranted: state.accessibilityGranted,
        screenRecordingGranted: state.screenRecordingGranted,
        error: state.error,
        loading: false,
      });
    });
    return unsub;
  }, []);

  const statusDot = (granted: boolean | null) => {
    if (granted === null) return "bg-[var(--text-muted)]";
    return granted ? "bg-[var(--green)]" : "bg-[var(--amber)]";
  };
  const missingPermission =
    accessibilityGranted === false || screenRecordingGranted === false;

  return (
    <div className="flex flex-col gap-6">
      <SettingsRow
        label={t.computer_use_enable_label}
        description={t.computer_use_enable_desc}
      >
        <OnOffSegment
          value={enabled}
          onChange={(next) => void (next ? cuEnable() : cuDisable())}
          disabled={{ on: loading || enabled, off: loading || !enabled }}
        />
      </SettingsRow>

      <div className="rounded-md border border-[var(--border)]">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-[12px] text-[var(--text-secondary)]">
            {t.computer_use_helper_status}
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex h-1.5 w-1.5 rounded-full ${
                error
                  ? "bg-[var(--red)]"
                  : helperRunning
                    ? "bg-[var(--green)]"
                    : "bg-[var(--text-muted)]"
              }`}
            />
            <span className="text-[12px] text-[var(--text-primary)]">
              {error
                ? t.computer_use_error
                : helperRunning
                  ? t.computer_use_running
                  : t.computer_use_stopped}
            </span>
          </div>
        </div>
        <div className="border-t border-[var(--border)] flex items-center justify-between px-3 py-2.5">
          <span className="text-[12px] text-[var(--text-secondary)]">
            {t.computer_use_accessibility}
          </span>
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-1.5 w-1.5 rounded-full ${statusDot(accessibilityGranted)}`} />
            <span className="text-[12px] text-[var(--text-primary)]">
              {accessibilityGranted ? t.computer_use_granted : t.computer_use_not_granted}
            </span>
          </div>
        </div>
        <div className="border-t border-[var(--border)] flex items-center justify-between px-3 py-2.5">
          <span className="text-[12px] text-[var(--text-secondary)]">
            {t.computer_use_screen_recording}
          </span>
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-1.5 w-1.5 rounded-full ${statusDot(screenRecordingGranted)}`} />
            <span className="text-[12px] text-[var(--text-primary)]">
              {screenRecordingGranted ? t.computer_use_granted : t.computer_use_not_granted}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-[var(--red)]/30 bg-[var(--red-soft)] px-3 py-2 text-[12px] text-[var(--red)]">
          {error}
        </div>
      )}

      {missingPermission && (
        <div className="rounded-md border border-[var(--amber)]/35 bg-[var(--amber)]/10 px-4 py-3.5">
          <div className="text-[12px] font-medium text-[var(--text-primary)] mb-1">
            {t.computer_use_permission_repair_title}
          </div>
          <p className="text-[12px] leading-relaxed text-[var(--text-secondary)] mb-2">
            {t.computer_use_permission_repair_desc}
          </p>
          <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            <li>{t.computer_use_permission_repair_step_open}</li>
            <li>{t.computer_use_permission_repair_step_remove}</li>
            <li>{t.computer_use_permission_repair_step_add_app}</li>
            <li>{t.computer_use_permission_repair_step_add_helper}</li>
            <li>{t.computer_use_permission_repair_step_refresh}</li>
          </ol>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className="text-[12px] text-[var(--accent)] hover:underline"
              onClick={openPermissions}
            >
              {t.computer_use_open_settings}
            </button>
            <button
              type="button"
              className="text-[12px] text-[var(--accent)] hover:underline disabled:text-[var(--text-muted)] disabled:no-underline"
              disabled={loading}
              onClick={() => void fetchStatus()}
            >
              {t.computer_use_refresh_status}
            </button>
          </div>
        </div>
      )}

      {enabled && (
        <div className="border-t border-[var(--border)] pt-5">
          <button
            type="button"
            className="px-3 py-1.5 rounded-md text-[12px] bg-[var(--red-soft)] text-[var(--red)] hover:brightness-110 transition-all duration-150"
            onClick={() => void cuStop()}
          >
            {t.computer_use_stop_btn}
          </button>
        </div>
      )}
    </div>
  );
}

const TAB_LABEL_KEYS: Record<Tab, string> = {
  general: "settings_general",
  appearance: "settings_appearance",
  features: "settings_features",
  agent: "settings_agent",
  shortcuts: "settings_shortcuts",
  "computer-use": "settings_computer_use",
};

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
    trackpadSwipeFocusEnabled,
    setTrackpadSwipeFocusEnabled,
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
  const [recordingKey, setRecordingKey] = useState<keyof ShortcutMap | null>(null);
  const [conflicts, setConflicts] = useState<Set<keyof ShortcutMap>>(new Set());
  const backdropRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [cliRegistered, setCliRegistered] = useState<boolean | null>(null);
  const [cliLoading, setCliLoading] = useState(false);
  const [cliPendingAction, setCliPendingAction] = useState<"register" | "unregister" | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  // Tabs we render in the rail. Computer Use is macOS-only; non-mac
  // platforms get a tighter list rather than a tab that surfaces a
  // useless row.
  const tabs = useMemo<Tab[]>(() => {
    const base: Tab[] = ["general", "appearance", "features", "agent", "shortcuts"];
    if (isMac) base.push("computer-use");
    return base;
  }, []);

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

  // Focus management — remember what was focused when the modal opened
  // so we can restore it on close, and move focus into the shell so
  // keyboard users can immediately tab through the form.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      const first = shellRef.current?.querySelector<HTMLElement>(
        '[data-rail-active="true"]',
      );
      first?.focus();
    });
    return () => {
      previouslyFocused.current?.focus?.();
    };
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

  const cliStatusText = effectiveCliRegistered ? t.cli_registered : t.cli_not_registered;

  const handleCliIntegrationToggle = useCallback(
    async (nextEnabled: boolean) => {
      setCliLoading(true);
      setCliPendingAction(nextEnabled ? "register" : "unregister");

      try {
        if (nextEnabled) {
          const result = await window.termcanvas.cli.register();
          if (!result.ok) {
            useNotificationStore.getState().notify("error", t.cli_register_failed);
            return;
          }
          if (!result.skillInstalled) {
            useNotificationStore.getState().notify("warn", t.cli_register_skill_failed);
          }
          setCliRegistered(true);
        } else {
          const ok = await window.termcanvas.cli.unregister();
          if (!ok) {
            useNotificationStore.getState().notify("error", t.cli_unregister_failed);
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

  // Keyboard handling. Three concerns share this listener so we can keep
  // capture-phase semantics consistent:
  //   1. Shortcut recording absorbs every keystroke when active.
  //   2. Esc closes when not recording.
  //   3. Tab/Shift+Tab cycles inside the shell (focus trap); when the
  //      focused element is a rail item, ↑/↓ flips between sections.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (recordingKey) {
        e.preventDefault();
        e.stopPropagation();
        const shortcut = eventToShortcut(e);
        if (!shortcut) return;
        const conflicting = Object.entries(shortcuts).find(
          ([k, v]) => k !== recordingKey && v === shortcut,
        );
        if (conflicting) {
          setConflicts(new Set([recordingKey, conflicting[0] as keyof ShortcutMap]));
          setTimeout(() => setConflicts(new Set()), 2000);
          setRecordingKey(null);
          return;
        }
        setShortcut(recordingKey, shortcut);
        setConflicts(new Set());
        setRecordingKey(null);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      const shell = shellRef.current;
      if (!shell) return;
      if (e.key === "Tab") {
        const focusables = Array.from(
          shell.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
      const active = document.activeElement as HTMLElement | null;
      if (active?.dataset.railItem === "true") {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const idx = tabs.indexOf(tab);
          const nextIdx =
            e.key === "ArrowDown"
              ? (idx + 1) % tabs.length
              : (idx - 1 + tabs.length) % tabs.length;
          setTab(tabs[nextIdx]);
          requestAnimationFrame(() => {
            const next = shell.querySelector<HTMLElement>(
              `[data-rail-tab="${tabs[nextIdx]}"]`,
            );
            next?.focus();
          });
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recordingKey, shortcuts, setShortcut, onClose, tab, tabs]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  const SectionHeader = ({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) => (
    <div className="mb-6 flex flex-col gap-1">
      <h3 className="tc-display">{title}</h3>
      {subtitle && <p className="tc-meta">{subtitle}</p>}
    </div>
  );

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 tc-enter-fade"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={t.settings}
    >
      <div
        ref={shellRef}
        className="tc-enter-fade-up flex max-h-[85vh] w-full max-w-3xl mx-4 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl"
        style={{ minHeight: 540 }}
      >
        {/* Header — settings title plus the discoverability cue: ⌘,
            and Esc as live keyboard chips. Reads as both crown and
            help line at the top of the surface. */}
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="tc-display">{t.settings}</h2>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
              <span className="tc-kbd" style={MONO_STYLE}>{isMac ? "⌘ ," : "Ctrl ,"}</span>
              <span>·</span>
              <span className="tc-kbd" style={MONO_STYLE}>Esc</span>
            </span>
            <button
              type="button"
              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
              onClick={onClose}
              aria-label="Close settings"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </header>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Rail — vertical category nav + persistent version footer.
              Sticky version row mirrors macOS System Settings: the
              user can always see what build they're on without paging
              into a tab for it. */}
          <nav
            aria-label="Settings sections"
            className="flex w-[180px] shrink-0 flex-col justify-between border-r border-[var(--border)] bg-[var(--sidebar)]"
          >
            <div className="flex flex-col gap-0.5 p-2">
              {tabs.map((id) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    data-rail-item="true"
                    data-rail-tab={id}
                    data-rail-active={active ? "true" : "false"}
                    className={`tc-settings-rail-item ${active ? "is-active" : ""}`}
                    onClick={() => setTab(id)}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="truncate text-left">
                      {(t as unknown as Record<string, string>)[TAB_LABEL_KEYS[id]]}
                    </span>
                  </button>
                );
              })}
            </div>
            <UpdateStatusLine appVersion={appVersion} />
          </nav>

          {/* Pane — keyed on `tab` so the entrance animation re-triggers
              per switch. Quick opacity fade only — no slide; settings is
              not a place where motion should distract. */}
          <div
            key={tab}
            className="tc-enter-fade-quick flex-1 overflow-y-auto px-7 py-6"
          >
            {tab === "general" && (
              <section>
                <SectionHeader title={t.settings_general} />
                <div className="flex flex-col gap-6">
                  <SettingsRow label={t.language}>
                    <ChoiceSegment
                      value={locale}
                      options={[
                        { value: "zh", label: "中文" },
                        { value: "en", label: "English" },
                      ]}
                      onChange={(v) => setLocale(v)}
                    />
                  </SettingsRow>

                  {cliRegistered !== null && (
                    <SettingsRow
                      label={
                        <span className="flex items-center gap-2">
                          {t.cli_label}
                          <span
                            className={`inline-flex h-1.5 w-1.5 rounded-full transition-opacity duration-150 motion-safe:animate-pulse ${
                              cliBusyLabel
                                ? "bg-[var(--accent)] opacity-100"
                                : "opacity-0"
                            }`}
                            aria-label={cliBusyLabel ?? undefined}
                            title={cliBusyLabel ?? undefined}
                          />
                        </span>
                      }
                      description={cliStatusText}
                    >
                      <OnOffSegment
                        value={!!effectiveCliRegistered}
                        onChange={(next) => void handleCliIntegrationToggle(next)}
                        disabled={{
                          on: cliLoading || effectiveCliRegistered === true,
                          off: cliLoading || effectiveCliRegistered === false,
                        }}
                      />
                    </SettingsRow>
                  )}
                </div>
              </section>
            )}

            {tab === "appearance" && (
              <section>
                <SectionHeader title={t.settings_appearance} />
                <div className="flex flex-col gap-6">
                  <SettingsRow label={t.terminal_font_size}>
                    <SliderControl
                      min={6}
                      max={24}
                      step={1}
                      value={fontSizeDraft}
                      onChange={(v) => {
                        setFontSizeDraft(v);
                        setTerminalFontSize(v);
                      }}
                      format={(v) => `${v}px`}
                    />
                  </SettingsRow>

                  <div className="flex flex-col gap-2">
                    <span className="tc-body-sm text-[var(--text-primary)]">
                      {t.terminal_font}
                    </span>
                    <div className="flex flex-col gap-0.5 max-h-[260px] overflow-y-auto rounded-md border border-[var(--border)] p-1">
                      {FONT_REGISTRY.map((font) => {
                        const isBuiltin = font.source === "builtin";
                        const isDownloaded = downloadedFonts.has(font.fileName);
                        const isAvailable = isBuiltin || isDownloaded;
                        const isSelected = terminalFontFamily === font.id;
                        const isDownloading = downloadingFont === font.id;
                        const fontBadgeClass =
                          "inline-flex min-w-[88px] justify-center text-[11px] px-1.5 py-0.5 rounded";

                        return (
                          <div
                            key={font.id}
                            className={`flex items-center justify-between px-3 py-2 rounded-md text-left transition-colors duration-100 ${
                              isSelected
                                ? "bg-[var(--accent-soft)] text-[var(--text-primary)]"
                                : isAvailable
                                  ? "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] cursor-pointer"
                                  : "text-[var(--text-muted)]"
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
                                  {"AaBbCc 0123 →→ {}"}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 ml-2 shrink-0">
                              {isBuiltin && (
                                <span
                                  className={`${fontBadgeClass} bg-[var(--surface)] text-[var(--text-muted)]`}
                                >
                                  {t.font_builtin}
                                </span>
                              )}
                              {!isBuiltin && isDownloaded && (
                                <span
                                  className={`${fontBadgeClass} bg-[var(--surface)] text-[var(--text-muted)]`}
                                >
                                  {t.font_downloaded}
                                </span>
                              )}
                              {!isBuiltin && !isDownloaded && !isDownloading && (
                                <button
                                  type="button"
                                  className={`${fontBadgeClass} bg-[var(--surface)] text-[var(--accent)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-100`}
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
                                <span
                                  className={`${fontBadgeClass} bg-[var(--surface)] text-[var(--text-muted)] flex items-center gap-1`}
                                  aria-live="polite"
                                >
                                  <svg className="animate-spin h-3 w-3" viewBox="0 0 16 16" fill="none">
                                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                                    <path
                                      d="M14 8a6 6 0 0 0-6-6"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                    />
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

                  <SettingsRow
                    label={t.terminal_renderer}
                    description={t.terminal_renderer_desc}
                    align="start"
                  >
                    <ChoiceSegment
                      value={terminalRenderer}
                      options={[
                        { value: "webgl", label: t.terminal_renderer_webgl },
                        { value: "dom", label: t.terminal_renderer_dom },
                      ]}
                      onChange={(v) => setTerminalRenderer(v)}
                    />
                  </SettingsRow>

                  <SettingsRow label={t.animation_blur}>
                    <SliderControl
                      min={0}
                      max={3}
                      step={0.1}
                      value={animationBlur}
                      onChange={setAnimationBlur}
                      format={(v) => (v === 0 ? t.setting_off : v.toFixed(1))}
                    />
                  </SettingsRow>

                  <SettingsRow label={t.minimum_contrast}>
                    <SliderControl
                      min={1}
                      max={7}
                      step={0.1}
                      value={minimumContrastRatio}
                      onChange={setMinimumContrastRatio}
                      format={(v) => (v <= 1 ? t.setting_off : v.toFixed(1))}
                    />
                  </SettingsRow>
                </div>
              </section>
            )}

            {tab === "features" && (
              <section>
                <SectionHeader title={t.settings_features} />
                <div className="flex flex-col gap-8">
                  <div className="flex flex-col gap-5">
                    <Eyebrow>
                      {(t as unknown as Record<string, string>).settings_features_group_canvas ??
                        "Canvas surfaces"}
                    </Eyebrow>
                    <SettingsRow
                      label={t.composer_toggle}
                      description={t.composer_toggle_desc}
                    >
                      <OnOffSegment value={composerEnabled} onChange={setComposerEnabled} />
                    </SettingsRow>
                    <SettingsRow
                      label={t.drawing_toggle}
                      description={t.drawing_toggle_desc}
                    >
                      <OnOffSegment value={drawingEnabled} onChange={setDrawingEnabled} />
                    </SettingsRow>
                    <SettingsRow
                      label={t.browser_toggle}
                      description={t.browser_toggle_desc}
                    >
                      <OnOffSegment value={browserEnabled} onChange={setBrowserEnabled} />
                    </SettingsRow>
                  </div>

                  <div className="flex flex-col gap-5">
                    <Eyebrow>
                      {(t as unknown as Record<string, string>).settings_features_group_workflow ??
                        "Workflow"}
                    </Eyebrow>
                    <SettingsRow
                      label={t.summary_toggle}
                      description={t.summary_toggle_desc}
                    >
                      <OnOffSegment value={summaryEnabled} onChange={setSummaryEnabled} />
                    </SettingsRow>

                    {summaryEnabled && (
                      <SettingsRow
                        label={t.summary_cli_label}
                        description={t.summary_cli_desc}
                      >
                        <ChoiceSegment
                          value={summaryCli}
                          options={[
                            { value: "claude", label: "Claude" },
                            { value: "codex", label: "Codex" },
                          ]}
                          onChange={(v) => setSummaryCli(v)}
                        />
                      </SettingsRow>
                    )}

                    <SettingsRow
                      label={t.global_search_toggle}
                      description={t.global_search_toggle_desc}
                    >
                      <OnOffSegment
                        value={globalSearchEnabled}
                        onChange={setGlobalSearchEnabled}
                      />
                    </SettingsRow>
                  </div>

                  <div className="flex flex-col gap-5">
                    <Eyebrow>
                      {(t as unknown as Record<string, string>).settings_features_group_ambient ??
                        "Ambient"}
                    </Eyebrow>
                    <SettingsRow label={t.pet_toggle} description={t.pet_toggle_desc}>
                      <OnOffSegment value={petEnabled} onChange={setPetEnabled} />
                    </SettingsRow>
                    <SettingsRow
                      label={t.completion_glow_toggle}
                      description={t.completion_glow_toggle_desc}
                    >
                      <OnOffSegment
                        value={completionGlowEnabled}
                        onChange={setCompletionGlowEnabled}
                      />
                    </SettingsRow>
                  </div>

                  {isMac && (
                    <div className="flex flex-col gap-5">
                      <Eyebrow>
                        {(t as unknown as Record<string, string>).settings_features_group_input ??
                          "Input"}
                      </Eyebrow>
                      <SettingsRow
                        label={t.trackpad_swipe_focus_toggle}
                        description={t.trackpad_swipe_focus_toggle_desc}
                      >
                        <OnOffSegment
                          value={trackpadSwipeFocusEnabled}
                          onChange={setTrackpadSwipeFocusEnabled}
                        />
                      </SettingsRow>
                    </div>
                  )}
                </div>
              </section>
            )}

            {tab === "agent" && (
              <section>
                <SectionHeader title={t.settings_agent} />
                <div className="flex flex-col gap-8">
                  <div className="flex flex-col gap-5">
                    <Eyebrow>{t.settings_section_agent_api}</Eyebrow>
                    <SettingsRow label={t.agent_provider}>
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
                    </SettingsRow>
                    {agentConfig.id === "custom" && (
                      <SettingsRow label={t.agent_format}>
                        <ChoiceSegment
                          value={agentConfig.type}
                          options={[
                            { value: "openai", label: "OpenAI" },
                            { value: "anthropic", label: "Anthropic" },
                          ]}
                          onChange={(v) => patchAgentConfig({ type: v })}
                        />
                      </SettingsRow>
                    )}
                    <SettingsRow label={t.agent_base_url}>
                      <TextInput
                        value={agentConfig.baseURL}
                        onChange={(v) => patchAgentConfig({ baseURL: v })}
                        placeholder="https://api.example.com/v1"
                      />
                    </SettingsRow>
                    <SettingsRow label={t.agent_api_key}>
                      <TextInput
                        type="password"
                        value={agentConfig.apiKey}
                        onChange={(v) => patchAgentConfig({ apiKey: v })}
                        placeholder={getPreset(agentConfig.id)?.keyPlaceholder ?? "..."}
                      />
                    </SettingsRow>
                    <SettingsRow label={t.agent_model}>
                      <TextInput
                        value={agentConfig.model}
                        onChange={(v) => patchAgentConfig({ model: v })}
                        placeholder={getPreset(agentConfig.id)?.defaultModel ?? ""}
                      />
                    </SettingsRow>
                  </div>

                  <div className="flex flex-col gap-3">
                    <Eyebrow>{t.settings_section_agent_cli}</Eyebrow>
                    <CliToolsList />
                  </div>
                </div>
              </section>
            )}

            {tab === "shortcuts" && (
              <section>
                <SectionHeader title={t.settings_shortcuts} />
                <div className="flex flex-col gap-8">
                  {SHORTCUT_GROUPS.map(({ eyebrowKey, items }) => (
                    <div key={eyebrowKey} className="flex flex-col gap-1">
                      <Eyebrow>
                        {(t as unknown as Record<string, string>)[eyebrowKey] ?? eyebrowKey}
                      </Eyebrow>
                      <div className="mt-1 overflow-hidden rounded-md border border-[var(--border)]">
                        {items.map(({ key, labelKey }, idx) => (
                          <div
                            key={key}
                            className={`flex items-center justify-between px-3 py-2 ${
                              idx > 0 ? "border-t border-[var(--border)]" : ""
                            }`}
                          >
                            <span className="text-[13px] text-[var(--text-primary)]">
                              {(t as unknown as Record<string, string>)[labelKey] ?? labelKey}
                            </span>
                            <ShortcutChip
                              value={shortcuts[key]}
                              isRecording={recordingKey === key}
                              onClick={() =>
                                setRecordingKey(recordingKey === key ? null : key)
                              }
                              conflict={conflicts.has(key)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div className="flex justify-end">
                    <button
                      type="button"
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
              </section>
            )}

            {tab === "computer-use" && (
              <section>
                <SectionHeader title={t.settings_computer_use ?? "Computer Use"} />
                <ComputerUseSection />
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
