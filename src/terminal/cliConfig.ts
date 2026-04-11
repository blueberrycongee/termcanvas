import type {
  ComposerSupportedTerminalType,
  TerminalStatus,
  TerminalType,
} from "../types";
import type { CliCommandConfig } from "../stores/preferencesStore";

export type ComposerImageFallbackMode = "image-path" | "error";
export type ComposerInputMode = "type" | "bracketed-paste";
export type ComposerPasteStrategy = "aggregate" | "separate";

interface TerminalLaunchConfig {
  shell: string;
  resumeArgs: (id: string) => string[];
  newArgs: () => string[];
  autoApproveArgs?: () => string[];
  promptArgs?: (prompt: string) => string[];
}

export interface ComposerAdapterConfig {
  supportsComposer: boolean;
  allowedStatuses: readonly TerminalStatus[];
  inputMode: ComposerInputMode;
  supportsImages: boolean;
  pasteKeySequence: (
    platform: "darwin" | "win32" | "linux",
  ) => string;
  imageFallback: ComposerImageFallbackMode;
  pasteDelayMs: number;
  pasteStrategy: ComposerPasteStrategy;
}

interface TerminalAdapterConfig {
  type: TerminalType;
  launch?: TerminalLaunchConfig;
  composer?: ComposerAdapterConfig;
}

const READY_STATUSES = [
  "idle",
  "waiting",
  "completed",
  "success",
] as const satisfies readonly TerminalStatus[];

const INTERACTIVE_STATUSES = [
  "running",
  "active",
  "waiting",
  "completed",
  "success",
  "idle",
] as const satisfies readonly TerminalStatus[];

const NO_COMPOSER: ComposerAdapterConfig = {
  supportsComposer: false,
  allowedStatuses: [],
  inputMode: "type",
  supportsImages: false,
  pasteKeySequence: () => "",
  imageFallback: "error",
  pasteDelayMs: 120,
  pasteStrategy: "separate",
};

export const TERMINAL_CONFIG: Record<TerminalType, TerminalAdapterConfig> = {
  shell: {
    type: "shell",
    composer: {
      supportsComposer: true,
      allowedStatuses: INTERACTIVE_STATUSES,
      inputMode: "type",
      supportsImages: false,
      pasteKeySequence: () => "",
      imageFallback: "error",
      pasteDelayMs: 0,
      pasteStrategy: "separate",
    },
  },
  claude: {
    type: "claude",
    launch: {
      shell: "claude",
      resumeArgs: (id) => ["--resume", id],
      newArgs: () => [],
      autoApproveArgs: () => ["--dangerously-skip-permissions"],
    },
    composer: {
      supportsComposer: true,
      allowedStatuses: INTERACTIVE_STATUSES,
      inputMode: "bracketed-paste",
      supportsImages: true,
      pasteKeySequence: () => "",
      imageFallback: "image-path",
      pasteDelayMs: 120,
      pasteStrategy: "aggregate",
    },
  },
  codex: {
    type: "codex",
    launch: {
      shell: "codex",
      resumeArgs: (id) => ["resume", id],
      newArgs: () => [],
      autoApproveArgs: () => ["--dangerously-bypass-approvals-and-sandbox"],
    },
    composer: {
      supportsComposer: true,
      allowedStatuses: INTERACTIVE_STATUSES,
      inputMode: "bracketed-paste",
      supportsImages: true,
      pasteKeySequence: () => "",
      imageFallback: "error",
      pasteDelayMs: 120,
      pasteStrategy: "separate",
    },
  },
  kimi: {
    type: "kimi",
    launch: {
      shell: "kimi",
      resumeArgs: (id) => ["-S", id],
      newArgs: () => [],
      promptArgs: (prompt) => ["--prompt", prompt],
    },
    composer: {
      supportsComposer: true,
      allowedStatuses: INTERACTIVE_STATUSES,
      inputMode: "bracketed-paste",
      supportsImages: true,
      pasteKeySequence: () => "",
      imageFallback: "image-path",
      pasteDelayMs: 120,
      pasteStrategy: "separate",
    },
  },
  gemini: {
    type: "gemini",
    launch: {
      shell: "gemini",
      resumeArgs: (id) => ["--resume", id],
      newArgs: () => [],
    },
    composer: {
      supportsComposer: true,
      allowedStatuses: INTERACTIVE_STATUSES,
      inputMode: "bracketed-paste",
      supportsImages: true,
      pasteKeySequence: () => "",
      imageFallback: "image-path",
      pasteDelayMs: 120,
      pasteStrategy: "separate",
    },
  },
  opencode: {
    type: "opencode",
    launch: {
      shell: "opencode",
      resumeArgs: (id) => ["-s", id],
      newArgs: () => [],
    },
    composer: {
      supportsComposer: true,
      allowedStatuses: INTERACTIVE_STATUSES,
      inputMode: "bracketed-paste",
      supportsImages: true,
      pasteKeySequence: () => "",
      imageFallback: "image-path",
      pasteDelayMs: 120,
      pasteStrategy: "separate",
    },
  },
  wuu: {
    type: "wuu",
    launch: {
      shell: "wuu",
      resumeArgs: (id) => ["--resume", id],
      newArgs: () => [],
      promptArgs: (prompt) => ["run", prompt],
    },
    composer: {
      supportsComposer: true,
      allowedStatuses: INTERACTIVE_STATUSES,
      inputMode: "bracketed-paste",
      supportsImages: false,
      pasteKeySequence: () => "",
      imageFallback: "error",
      pasteDelayMs: 120,
      pasteStrategy: "separate",
    },
  },
  lazygit: {
    type: "lazygit",
    launch: {
      shell: "lazygit",
      resumeArgs: () => [],
      newArgs: () => [],
    },
    composer: {
      supportsComposer: true,
      allowedStatuses: INTERACTIVE_STATUSES,
      inputMode: "type",
      supportsImages: false,
      pasteKeySequence: () => "",
      imageFallback: "error",
      pasteDelayMs: 0,
      pasteStrategy: "separate",
    },
  },
  tmux: {
    type: "tmux",
    launch: {
      shell: "tmux",
      resumeArgs: (name) => ["attach", "-t", name],
      newArgs: () => [],
    },
    composer: {
      supportsComposer: true,
      allowedStatuses: INTERACTIVE_STATUSES,
      inputMode: "type",
      supportsImages: false,
      pasteKeySequence: () => "",
      imageFallback: "error",
      pasteDelayMs: 0,
      pasteStrategy: "separate",
    },
  },
};

export function getTerminalLaunchOptions(
  type: TerminalType,
  sessionId: string | undefined,
  autoApprove?: boolean,
  cliOverride?: CliCommandConfig,
): { shell: string; args: string[] } | null {
  const config = TERMINAL_CONFIG[type].launch;
  if (!config) return null;

  const shell = cliOverride?.command || config.shell;
  const extraArgs = cliOverride?.args ?? [];
  const base = sessionId ? config.resumeArgs(sessionId) : config.newArgs();
  const extra =
    autoApprove && config.autoApproveArgs
      ? config.autoApproveArgs()
      : [];

  return {
    shell,
    args: [...extraArgs, ...extra, ...base],
  };
}

export function getTerminalPromptArgs(
  type: TerminalType,
  prompt: string,
): string[] {
  const config = TERMINAL_CONFIG[type].launch;
  if (!config) return [prompt];
  return config.promptArgs ? config.promptArgs(prompt) : [prompt];
}

export function getComposerAdapter(
  type: TerminalType,
): ComposerAdapterConfig | null {
  const composer = TERMINAL_CONFIG[type].composer ?? NO_COMPOSER;
  return composer.supportsComposer ? composer : null;
}

export function isComposerSupportedTerminal(
  type: TerminalType,
): type is ComposerSupportedTerminalType {
  return getComposerAdapter(type) !== null;
}
