import { create } from "zustand";
import type { TerminalType } from "../types/index.ts";
import type { AgentProviderConfig } from "../agentProviders";
import { defaultProviderConfig, getPreset, PROVIDER_PRESETS } from "../agentProviders";

const DEFAULT_BLUR = 0;
const DEFAULT_FONT_SIZE = 13;
const DEFAULT_MIN_CONTRAST = 1;
const LEGACY_ENABLED_BLUR = 1.5;

export type TerminalRendererMode = "dom" | "webgl";

export interface CliCommandConfig {
  command: string;
  args: string[];
}

export interface StoredTerminalSize {
  w: number;
  h: number;
}

interface PreferencesStore {
  animationBlur: number;
  terminalFontSize: number;
  terminalFontFamily: string;
  terminalRenderer: TerminalRendererMode;
  composerEnabled: boolean;
  drawingEnabled: boolean;
  browserEnabled: boolean;
  summaryEnabled: boolean;
  globalSearchEnabled: boolean;
  petEnabled: boolean;
  completionGlowEnabled: boolean;
  trackpadSwipeFocusEnabled: boolean;
  summaryCli: "claude" | "codex";
  minimumContrastRatio: number;
  cliCommands: Partial<Record<TerminalType, CliCommandConfig>>;
  /**
   * User's preferred default size for newly-created terminals. Populated
   * the first time the user resizes a terminal; null/undefined means
   * "fall back to the panel-aware computed default". Decoupling the
   * default from the current sidebar state is the whole point — otherwise
   * opening the right panel between two `+ Terminal` clicks makes them
   * different sizes.
   */
  defaultTerminalSize: StoredTerminalSize | null;

  agentConfig: AgentProviderConfig;
  apiKeyReady: boolean;

  /**
   * Per-id flag bag for capability discovery cues. A cue is "seen" once
   * the user has acted on it or dismissed it. We persist only the `true`
   * side; absence means "not seen yet". Keeping the schema this thin
   * lets new cue ids drop in without a migration.
   */
  seenHints: Record<string, true>;

  setAnimationBlur: (value: number) => void;
  setMinimumContrastRatio: (value: number) => void;
  setTerminalFontSize: (value: number) => void;
  setTerminalFontFamily: (fontId: string) => void;
  setTerminalRenderer: (mode: TerminalRendererMode) => void;
  setComposerEnabled: (value: boolean) => void;
  setDrawingEnabled: (value: boolean) => void;
  setBrowserEnabled: (value: boolean) => void;
  setSummaryEnabled: (value: boolean) => void;
  setGlobalSearchEnabled: (value: boolean) => void;
  setPetEnabled: (value: boolean) => void;
  setCompletionGlowEnabled: (value: boolean) => void;
  setTrackpadSwipeFocusEnabled: (value: boolean) => void;
  setSummaryCli: (value: "claude" | "codex") => void;
  setCli: (type: TerminalType, config: CliCommandConfig | null) => void;
  setAgentConfig: (config: AgentProviderConfig) => void;
  patchAgentConfig: (patch: Partial<AgentProviderConfig>) => void;
  setDefaultTerminalSize: (size: StoredTerminalSize | null) => void;
  markHintSeen: (hintId: string) => void;
}

const STORAGE_KEY = "termcanvas-preferences";
const SECURE_API_KEY_STORAGE_KEY = "termcanvas-secure-apikey";
const PLAINTEXT_FALLBACK_PREFIX = "plain:";

interface SavedPrefs {
  animationBlur: number;
  terminalFontSize: number;
  terminalFontFamily: string;
  terminalRenderer: TerminalRendererMode;
  composerEnabled: boolean;
  drawingEnabled: boolean;
  browserEnabled: boolean;
  summaryEnabled: boolean;
  globalSearchEnabled: boolean;
  petEnabled: boolean;
  completionGlowEnabled: boolean;
  trackpadSwipeFocusEnabled: boolean;
  summaryCli: "claude" | "codex";
  minimumContrastRatio: number;
  cliCommands: Partial<Record<TerminalType, CliCommandConfig>>;
  defaultTerminalSize: StoredTerminalSize | null;
  agentConfig: AgentProviderConfig;
  seenHints: Record<string, true>;
}

function sanitizeSeenHints(value: unknown): Record<string, true> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, true> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === true) out[k] = true;
  }
  return out;
}

// Sanity bounds for persisted default size — guards against a corrupt
// localStorage entry, NOT meant to restrict what the user can save from a
// drag-resize. The user's actual resize handle allows arbitrary sizes;
// these just reject implausible values like 10 × 10 or 50_000 × 50_000.
const PREF_SIZE_MIN_W = 200;
const PREF_SIZE_MAX_W = 4000;
const PREF_SIZE_MIN_H = 120;
const PREF_SIZE_MAX_H = 3000;

export function sanitizeStoredTerminalSize(
  value: unknown,
): StoredTerminalSize | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const w = raw.w;
  const h = raw.h;
  if (typeof w !== "number" || typeof h !== "number") return null;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < PREF_SIZE_MIN_W || w > PREF_SIZE_MAX_W) return null;
  if (h < PREF_SIZE_MIN_H || h > PREF_SIZE_MAX_H) return null;
  return { w: Math.round(w), h: Math.round(h) };
}

function migrateOldAgentFields(parsed: Record<string, unknown>): AgentProviderConfig {
  const oldProvider = parsed.agentProvider as string | undefined;
  const oldKey = (parsed.agentApiKey as string) ?? "";
  const oldModel = (parsed.agentModel as string) ?? "";

  const preset = getPreset(oldProvider ?? "anthropic") ?? PROVIDER_PRESETS[0];
  return {
    id: preset.id,
    name: preset.name,
    type: preset.type,
    baseURL: preset.baseURL,
    apiKey: oldKey,
    model: oldModel || preset.defaultModel,
  };
}

function loadAgentConfig(parsed: Record<string, unknown>): AgentProviderConfig {
  const raw = parsed.agentConfig;
  if (raw && typeof raw === "object" && "id" in (raw as object) && "type" in (raw as object)) {
    const cfg = raw as Record<string, unknown>;
    return {
      id: (cfg.id as string) ?? "anthropic",
      name: (cfg.name as string) ?? "Anthropic",
      type: (cfg.type as "anthropic" | "openai") ?? "anthropic",
      baseURL: (cfg.baseURL as string) ?? "",
      apiKey: "",
      model: (cfg.model as string) ?? "",
    };
  }
  // Old format — migrate (apiKey decrypted later by hydrateApiKey)
  const migrated = migrateOldAgentFields(parsed);
  return { ...migrated, apiKey: "" };
}

function loadPreferences(): SavedPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      let blur = DEFAULT_BLUR;
      const v = parsed.animationBlur;
      if (v === true) blur = LEGACY_ENABLED_BLUR;
      else if (v === false) blur = 0;
      else if (typeof v === "number" && v >= 0 && v <= 3) blur = v;

      let fontSize = DEFAULT_FONT_SIZE;
      const f = parsed.terminalFontSize;
      if (typeof f === "number" && f >= 6 && f <= 24) fontSize = f;

      let fontFamily = "geist-mono";
      const ff = parsed.terminalFontFamily;
      if (typeof ff === "string" && ff.length > 0) fontFamily = ff;

      let terminalRenderer: TerminalRendererMode = "webgl";
      if (parsed.terminalRenderer === "dom") {
        terminalRenderer = "dom";
      }

      let composerEnabled = false;
      if (parsed.composerEnabled === true) composerEnabled = true;

      let drawingEnabled = false;
      if (parsed.drawingEnabled === true) drawingEnabled = true;

      let browserEnabled = false;
      if (parsed.browserEnabled === true) browserEnabled = true;

      let summaryEnabled = false;
      if (parsed.summaryEnabled === true) summaryEnabled = true;

      let globalSearchEnabled = false;
      if (parsed.globalSearchEnabled === true) globalSearchEnabled = true;

      let petEnabled = false;
      if (parsed.petEnabled === true) petEnabled = true;

      let completionGlowEnabled = false;
      if (parsed.completionGlowEnabled === true) completionGlowEnabled = true;

      let trackpadSwipeFocusEnabled = false;
      if (parsed.trackpadSwipeFocusEnabled === true) trackpadSwipeFocusEnabled = true;

      let summaryCli: "claude" | "codex" = "claude";
      if (parsed.summaryCli === "codex") summaryCli = "codex";

      let minimumContrastRatio = DEFAULT_MIN_CONTRAST;
      const mcr = parsed.minimumContrastRatio;
      if (typeof mcr === "number" && mcr >= 1 && mcr <= 7) minimumContrastRatio = mcr;

      const cliCommands: Partial<Record<TerminalType, CliCommandConfig>> = {};
      if (parsed.cliCommands && typeof parsed.cliCommands === "object") {
        for (const [key, val] of Object.entries(parsed.cliCommands)) {
          if (val && typeof val === "object" && typeof (val as CliCommandConfig).command === "string") {
            cliCommands[key as TerminalType] = val as CliCommandConfig;
          }
        }
      }

      const agentConfig = loadAgentConfig(parsed);
      const defaultTerminalSize = sanitizeStoredTerminalSize(
        parsed.defaultTerminalSize,
      );
      const seenHints = sanitizeSeenHints(parsed.seenHints);

      return {
        animationBlur: blur,
        terminalFontSize: fontSize,
        terminalFontFamily: fontFamily,
        terminalRenderer,
        composerEnabled,
        drawingEnabled,
        browserEnabled,
        summaryEnabled,
        globalSearchEnabled,
        petEnabled,
        completionGlowEnabled,
        trackpadSwipeFocusEnabled,
        summaryCli,
        minimumContrastRatio,
        cliCommands,
        defaultTerminalSize,
        agentConfig,
        seenHints,
      };
    }
  } catch {
  }
  return {
    animationBlur: DEFAULT_BLUR,
    terminalFontSize: DEFAULT_FONT_SIZE,
    terminalFontFamily: "geist-mono",
    terminalRenderer: "webgl",
    composerEnabled: false,
    drawingEnabled: false,
    browserEnabled: false,
    summaryEnabled: false,
    globalSearchEnabled: false,
    petEnabled: false,
    completionGlowEnabled: false,
    trackpadSwipeFocusEnabled: false,
    summaryCli: "claude",
    minimumContrastRatio: DEFAULT_MIN_CONTRAST,
    cliCommands: {},
    defaultTerminalSize: null,
    agentConfig: defaultProviderConfig(),
    seenHints: {},
  };
}

function savePreferences(state: SavedPrefs) {
  const stripped = { ...state, agentConfig: { ...state.agentConfig, apiKey: "" } };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
  void saveApiKeySecure(state.agentConfig.apiKey);
}

async function saveApiKeySecure(apiKey: string): Promise<void> {
  if (!apiKey) {
    localStorage.removeItem(SECURE_API_KEY_STORAGE_KEY);
    return;
  }
  if (!window.termcanvas?.secure) {
    localStorage.setItem(SECURE_API_KEY_STORAGE_KEY, PLAINTEXT_FALLBACK_PREFIX + apiKey);
    return;
  }
  try {
    const encrypted = await window.termcanvas.secure.encrypt(apiKey);
    localStorage.setItem(SECURE_API_KEY_STORAGE_KEY, encrypted);
  } catch {
    localStorage.setItem(SECURE_API_KEY_STORAGE_KEY, PLAINTEXT_FALLBACK_PREFIX + apiKey);
  }
}

export async function hydrateApiKey(): Promise<void> {
  const { getState, setState } = usePreferencesStore;

  if (!window.termcanvas?.secure) {
    // Not in Electron — fall back to legacy plaintext
    const legacyKey = readLegacyApiKey();
    if (legacyKey) {
      getState().patchAgentConfig({ apiKey: legacyKey });
    }
    setState({ apiKeyReady: true });
    return;
  }

  try {
    const secureValue = localStorage.getItem(SECURE_API_KEY_STORAGE_KEY);
    if (secureValue) {
      let apiKey: string;
      if (secureValue.startsWith(PLAINTEXT_FALLBACK_PREFIX)) {
        apiKey = secureValue.slice(PLAINTEXT_FALLBACK_PREFIX.length);
        // Attempt upgrade to encrypted now that we're running
        try {
          const encrypted = await window.termcanvas.secure.encrypt(apiKey);
          localStorage.setItem(SECURE_API_KEY_STORAGE_KEY, encrypted);
        } catch { /* keep plaintext fallback */ }
      } else {
        apiKey = await window.termcanvas.secure.decrypt(secureValue);
      }
      if (apiKey) {
        getState().patchAgentConfig({ apiKey });
      }
      setState({ apiKeyReady: true });
      return;
    }

    const legacyKey = readLegacyApiKey();
    if (legacyKey) {
      getState().patchAgentConfig({ apiKey: legacyKey });
    }
  } catch {
    // Decryption or parse failure — discard corrupted data
    localStorage.removeItem(SECURE_API_KEY_STORAGE_KEY);
  }

  setState({ apiKeyReady: true });
}

function readLegacyApiKey(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return (parsed.agentConfig?.apiKey as string) ?? (parsed.agentApiKey as string) ?? "";
  } catch {
    return "";
  }
}

function getSaveState(state: PreferencesStore): SavedPrefs {
  return {
    animationBlur: state.animationBlur,
    terminalFontSize: state.terminalFontSize,
    terminalFontFamily: state.terminalFontFamily,
    terminalRenderer: state.terminalRenderer,
    composerEnabled: state.composerEnabled,
    drawingEnabled: state.drawingEnabled,
    browserEnabled: state.browserEnabled,
    summaryEnabled: state.summaryEnabled,
    globalSearchEnabled: state.globalSearchEnabled,
    petEnabled: state.petEnabled,
    completionGlowEnabled: state.completionGlowEnabled,
    trackpadSwipeFocusEnabled: state.trackpadSwipeFocusEnabled,
    summaryCli: state.summaryCli,
    minimumContrastRatio: state.minimumContrastRatio,
    cliCommands: state.cliCommands,
    defaultTerminalSize: state.defaultTerminalSize,
    agentConfig: state.agentConfig,
    seenHints: state.seenHints,
  };
}

const initialPrefs = loadPreferences();

export const usePreferencesStore = create<PreferencesStore>((set, get) => ({
  animationBlur: initialPrefs.animationBlur,
  terminalFontSize: initialPrefs.terminalFontSize,
  terminalFontFamily: initialPrefs.terminalFontFamily,
  terminalRenderer: initialPrefs.terminalRenderer,
  composerEnabled: initialPrefs.composerEnabled,
  drawingEnabled: initialPrefs.drawingEnabled,
  browserEnabled: initialPrefs.browserEnabled,
  summaryEnabled: initialPrefs.summaryEnabled,
  globalSearchEnabled: initialPrefs.globalSearchEnabled,
  petEnabled: initialPrefs.petEnabled,
  completionGlowEnabled: initialPrefs.completionGlowEnabled,
  trackpadSwipeFocusEnabled: initialPrefs.trackpadSwipeFocusEnabled,
  summaryCli: initialPrefs.summaryCli,
  minimumContrastRatio: initialPrefs.minimumContrastRatio,
  cliCommands: initialPrefs.cliCommands,
  defaultTerminalSize: initialPrefs.defaultTerminalSize,
  agentConfig: initialPrefs.agentConfig,
  apiKeyReady: false,
  seenHints: initialPrefs.seenHints,

  setAnimationBlur: (value) => {
    const clamped = Math.round(Math.max(0, Math.min(3, value)) * 10) / 10;
    set({ animationBlur: clamped });
    savePreferences(getSaveState({ ...get(), animationBlur: clamped }));
  },
  setMinimumContrastRatio: (value) => {
    const clamped = Math.round(Math.max(1, Math.min(7, value)) * 10) / 10;
    set({ minimumContrastRatio: clamped });
    savePreferences(getSaveState({ ...get(), minimumContrastRatio: clamped }));
  },
  setTerminalFontSize: (value) => {
    const clamped = Math.max(6, Math.min(24, Math.round(value)));
    set({ terminalFontSize: clamped });
    savePreferences(getSaveState({ ...get(), terminalFontSize: clamped }));
  },
  setTerminalFontFamily: (fontId) => {
    set({ terminalFontFamily: fontId });
    savePreferences(getSaveState({ ...get(), terminalFontFamily: fontId }));
  },
  setTerminalRenderer: (mode) => {
    set({ terminalRenderer: mode });
    savePreferences(getSaveState({ ...get(), terminalRenderer: mode }));
  },
  setComposerEnabled: (value) => {
    set({ composerEnabled: value });
    savePreferences(getSaveState({ ...get(), composerEnabled: value }));
  },
  setDrawingEnabled: (value) => {
    set({ drawingEnabled: value });
    savePreferences(getSaveState({ ...get(), drawingEnabled: value }));
  },
  setBrowserEnabled: (value) => {
    set({ browserEnabled: value });
    savePreferences(getSaveState({ ...get(), browserEnabled: value }));
  },
  setSummaryEnabled: (value) => {
    set({ summaryEnabled: value });
    savePreferences(getSaveState({ ...get(), summaryEnabled: value }));
  },
  setGlobalSearchEnabled: (value) => {
    set({ globalSearchEnabled: value });
    savePreferences(getSaveState({ ...get(), globalSearchEnabled: value }));
  },
  setPetEnabled: (value) => {
    set({ petEnabled: value });
    savePreferences(getSaveState({ ...get(), petEnabled: value }));
  },
  setCompletionGlowEnabled: (value) => {
    set({ completionGlowEnabled: value });
    savePreferences(getSaveState({ ...get(), completionGlowEnabled: value }));
  },
  setTrackpadSwipeFocusEnabled: (value) => {
    set({ trackpadSwipeFocusEnabled: value });
    savePreferences(getSaveState({ ...get(), trackpadSwipeFocusEnabled: value }));
  },
  setSummaryCli: (value) => {
    set({ summaryCli: value });
    savePreferences(getSaveState({ ...get(), summaryCli: value }));
  },
  setCli: (type, config) => {
    const current = { ...get().cliCommands };
    if (config) {
      current[type] = config;
    } else {
      delete current[type];
    }
    set({ cliCommands: current });
    savePreferences(getSaveState({ ...get(), cliCommands: current }));
  },
  setAgentConfig: (config) => {
    set({ agentConfig: config });
    savePreferences(getSaveState({ ...get(), agentConfig: config }));
  },
  patchAgentConfig: (patch) => {
    const current = get().agentConfig;
    const updated = { ...current, ...patch };
    set({ agentConfig: updated });
    savePreferences(getSaveState({ ...get(), agentConfig: updated }));
  },
  setDefaultTerminalSize: (size) => {
    const sanitized = size === null ? null : sanitizeStoredTerminalSize(size);
    set({ defaultTerminalSize: sanitized });
    savePreferences(
      getSaveState({ ...get(), defaultTerminalSize: sanitized }),
    );
  },
  markHintSeen: (hintId) => {
    const current = get().seenHints;
    if (current[hintId]) return;
    const next = { ...current, [hintId]: true as const };
    set({ seenHints: next });
    savePreferences(getSaveState({ ...get(), seenHints: next }));
  },
}));
