import { create } from "zustand";
import type { TerminalType } from "../types/index.ts";
import type { AgentProviderConfig } from "../agentProviders";
import { defaultProviderConfig, getPreset, PROVIDER_PRESETS } from "../agentProviders";
import {
  DEFAULT_TERMINAL_BACKEND,
  isTerminalBackendKind,
  type TerminalBackendKind,
} from "../terminal/backend/TerminalBackend.ts";

const DEFAULT_BLUR = 0;
const DEFAULT_FONT_SIZE = 13;
const DEFAULT_MIN_CONTRAST = 1;
const LEGACY_ENABLED_BLUR = 1.5;

export interface CliCommandConfig {
  command: string;
  args: string[];
}

interface PreferencesStore {
  animationBlur: number;
  terminalFontSize: number;
  terminalFontFamily: string;
  composerEnabled: boolean;
  drawingEnabled: boolean;
  browserEnabled: boolean;
  summaryEnabled: boolean;
  globalSearchEnabled: boolean;
  petEnabled: boolean;
  summaryCli: "claude" | "codex";
  minimumContrastRatio: number;
  terminalBackend: TerminalBackendKind;
  cliCommands: Partial<Record<TerminalType, CliCommandConfig>>;

  agentConfig: AgentProviderConfig;
  apiKeyReady: boolean;

  setAnimationBlur: (value: number) => void;
  setMinimumContrastRatio: (value: number) => void;
  setTerminalFontSize: (value: number) => void;
  setTerminalFontFamily: (fontId: string) => void;
  setComposerEnabled: (value: boolean) => void;
  setDrawingEnabled: (value: boolean) => void;
  setBrowserEnabled: (value: boolean) => void;
  setSummaryEnabled: (value: boolean) => void;
  setGlobalSearchEnabled: (value: boolean) => void;
  setPetEnabled: (value: boolean) => void;
  setSummaryCli: (value: "claude" | "codex") => void;
  setTerminalBackend: (value: TerminalBackendKind) => void;
  setCli: (type: TerminalType, config: CliCommandConfig | null) => void;
  setAgentConfig: (config: AgentProviderConfig) => void;
  patchAgentConfig: (patch: Partial<AgentProviderConfig>) => void;
}

const STORAGE_KEY = "termcanvas-preferences";
const SECURE_API_KEY_STORAGE_KEY = "termcanvas-secure-apikey";
const PLAINTEXT_FALLBACK_PREFIX = "plain:";

interface SavedPrefs {
  animationBlur: number;
  terminalFontSize: number;
  terminalFontFamily: string;
  composerEnabled: boolean;
  drawingEnabled: boolean;
  browserEnabled: boolean;
  summaryEnabled: boolean;
  globalSearchEnabled: boolean;
  petEnabled: boolean;
  summaryCli: "claude" | "codex";
  minimumContrastRatio: number;
  terminalBackend: TerminalBackendKind;
  cliCommands: Partial<Record<TerminalType, CliCommandConfig>>;
  agentConfig: AgentProviderConfig;
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

      let summaryCli: "claude" | "codex" = "claude";
      if (parsed.summaryCli === "codex") summaryCli = "codex";

      let minimumContrastRatio = DEFAULT_MIN_CONTRAST;
      const mcr = parsed.minimumContrastRatio;
      if (typeof mcr === "number" && mcr >= 1 && mcr <= 7) minimumContrastRatio = mcr;

      let terminalBackend: TerminalBackendKind = DEFAULT_TERMINAL_BACKEND;
      if (isTerminalBackendKind(parsed.terminalBackend)) {
        terminalBackend = parsed.terminalBackend;
      }

      const cliCommands: Partial<Record<TerminalType, CliCommandConfig>> = {};
      if (parsed.cliCommands && typeof parsed.cliCommands === "object") {
        for (const [key, val] of Object.entries(parsed.cliCommands)) {
          if (val && typeof val === "object" && typeof (val as CliCommandConfig).command === "string") {
            cliCommands[key as TerminalType] = val as CliCommandConfig;
          }
        }
      }

      const agentConfig = loadAgentConfig(parsed);

      return {
        animationBlur: blur,
        terminalFontSize: fontSize,
        terminalFontFamily: fontFamily,
        composerEnabled,
        drawingEnabled,
        browserEnabled,
        summaryEnabled,
        globalSearchEnabled,
        petEnabled,
        summaryCli,
        minimumContrastRatio,
        terminalBackend,
        cliCommands,
        agentConfig,
      };
    }
  } catch {
  }
  return {
    animationBlur: DEFAULT_BLUR,
    terminalFontSize: DEFAULT_FONT_SIZE,
    terminalFontFamily: "geist-mono",
    composerEnabled: false,
    drawingEnabled: false,
    browserEnabled: false,
    summaryEnabled: false,
    globalSearchEnabled: false,
    petEnabled: false,
    summaryCli: "claude",
    minimumContrastRatio: DEFAULT_MIN_CONTRAST,
    terminalBackend: DEFAULT_TERMINAL_BACKEND,
    cliCommands: {},
    agentConfig: defaultProviderConfig(),
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
    composerEnabled: state.composerEnabled,
    drawingEnabled: state.drawingEnabled,
    browserEnabled: state.browserEnabled,
    summaryEnabled: state.summaryEnabled,
    globalSearchEnabled: state.globalSearchEnabled,
    petEnabled: state.petEnabled,
    summaryCli: state.summaryCli,
    minimumContrastRatio: state.minimumContrastRatio,
    terminalBackend: state.terminalBackend,
    cliCommands: state.cliCommands,
    agentConfig: state.agentConfig,
  };
}

const initialPrefs = loadPreferences();

export const usePreferencesStore = create<PreferencesStore>((set, get) => ({
  animationBlur: initialPrefs.animationBlur,
  terminalFontSize: initialPrefs.terminalFontSize,
  terminalFontFamily: initialPrefs.terminalFontFamily,
  composerEnabled: initialPrefs.composerEnabled,
  drawingEnabled: initialPrefs.drawingEnabled,
  browserEnabled: initialPrefs.browserEnabled,
  summaryEnabled: initialPrefs.summaryEnabled,
  globalSearchEnabled: initialPrefs.globalSearchEnabled,
  petEnabled: initialPrefs.petEnabled,
  summaryCli: initialPrefs.summaryCli,
  minimumContrastRatio: initialPrefs.minimumContrastRatio,
  terminalBackend: initialPrefs.terminalBackend,
  cliCommands: initialPrefs.cliCommands,
  agentConfig: initialPrefs.agentConfig,
  apiKeyReady: false,

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
  setSummaryCli: (value) => {
    set({ summaryCli: value });
    savePreferences(getSaveState({ ...get(), summaryCli: value }));
  },
  setTerminalBackend: (value) => {
    set({ terminalBackend: value });
    savePreferences(getSaveState({ ...get(), terminalBackend: value }));
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
}));
