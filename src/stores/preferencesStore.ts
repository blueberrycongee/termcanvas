import { create } from "zustand";
import type { TerminalType } from "../types/index.ts";
import type { AgentProviderConfig } from "../agentProviders";
import { defaultProviderConfig, getPreset, PROVIDER_PRESETS } from "../agentProviders";
import { preferencesSchema } from "./preferencesSchema.ts";

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
  summaryCli: "claude" | "codex";
  minimumContrastRatio: number;
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
  setSummaryCli: (value: "claude" | "codex") => void;
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
  summaryCli: "claude" | "codex";
  minimumContrastRatio: number;
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

function loadPreferences(): SavedPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const rawParsed = JSON.parse(raw);

      // Migrate legacy agent fields before schema parse
      if (
        !rawParsed.agentConfig ||
        typeof rawParsed.agentConfig !== "object" ||
        !("id" in rawParsed.agentConfig) ||
        !("type" in rawParsed.agentConfig)
      ) {
        rawParsed.agentConfig = migrateOldAgentFields(rawParsed);
      }

      // Validate field-by-field: valid values are kept, invalid ones fall back to defaults.
      // This preserves partially valid persisted data (matching the original behavior).
      const defaults = preferencesSchema.parse({});
      const result: Record<string, unknown> = {};

      for (const [key, fieldSchema] of Object.entries(
        preferencesSchema.shape as Record<string, import("zod").ZodTypeAny>,
      )) {
        const fieldValue = rawParsed[key];
        if (fieldValue === undefined) {
          result[key] = defaults[key as keyof typeof defaults];
          continue;
        }
        const fieldResult = (fieldSchema as import("zod").ZodTypeAny).safeParse(fieldValue);
        result[key] = fieldResult.success ? fieldResult.data : defaults[key as keyof typeof defaults];
      }

      return {
        ...result,
        agentConfig: {
          ...(result.agentConfig as AgentProviderConfig),
          apiKey: "",
        },
      } as SavedPrefs;
    }
  } catch (e) {
    console.error("Failed to load preferences:", e);
  }
  return preferencesSchema.parse({});
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
    summaryCli: state.summaryCli,
    minimumContrastRatio: state.minimumContrastRatio,
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
  summaryCli: initialPrefs.summaryCli,
  minimumContrastRatio: initialPrefs.minimumContrastRatio,
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
}));
