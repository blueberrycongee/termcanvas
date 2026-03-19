import type {
  ComposerSupportedTerminalType,
  TerminalStatus,
  TerminalType,
} from "../types";

export type ComposerImageFallbackMode = "image-path" | "error";
export type ComposerInputMode = "type" | "bracketed-paste";

interface TerminalLaunchConfig {
  shell: string;
  resumeArgs: (id: string) => string[];
  newArgs: () => string[];
  autoApproveArgs?: () => string[];
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
    },
  },
  kimi: {
    type: "kimi",
    launch: {
      shell: "kimi",
      resumeArgs: (id) => ["-S", id],
      newArgs: () => [],
    },
    composer: {
      supportsComposer: true,
      allowedStatuses: INTERACTIVE_STATUSES,
      inputMode: "bracketed-paste",
      supportsImages: true,
      pasteKeySequence: () => "",
      imageFallback: "image-path",
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
    },
  },
};

export function getTerminalLaunchOptions(
  type: TerminalType,
  sessionId: string | undefined,
  autoApprove?: boolean,
): { shell: string; args: string[] } | null {
  const config = TERMINAL_CONFIG[type].launch;
  if (!config) return null;

  const base = sessionId ? config.resumeArgs(sessionId) : config.newArgs();
  const extra =
    autoApprove && !sessionId && config.autoApproveArgs
      ? config.autoApproveArgs()
      : [];

  return {
    shell: config.shell,
    args: [...extra, ...base],
  };
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
