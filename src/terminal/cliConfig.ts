import type {
  ComposerSupportedTerminalType,
  TerminalStatus,
  TerminalType,
} from "../types";

export type ComposerImageFallbackMode = "image-path" | "error";

interface TerminalLaunchConfig {
  shell: string;
  resumeArgs: (id: string) => string[];
  newArgs: () => string[];
}

export interface ComposerAdapterConfig {
  supportsComposer: boolean;
  allowedStatuses: readonly TerminalStatus[];
  pasteKeySequence: (
    platform: "darwin" | "win32" | "linux",
  ) => string;
  imageFallback: ComposerImageFallbackMode;
  pasteDelayMs: number;
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

const NO_COMPOSER: ComposerAdapterConfig = {
  supportsComposer: false,
  allowedStatuses: [],
  pasteKeySequence: () => "",
  imageFallback: "error",
  pasteDelayMs: 120,
};

export const TERMINAL_CONFIG: Record<TerminalType, TerminalAdapterConfig> = {
  shell: {
    type: "shell",
    composer: NO_COMPOSER,
  },
  claude: {
    type: "claude",
    launch: {
      shell: "claude",
      resumeArgs: (id) => ["--resume", id],
      newArgs: () => [],
    },
    composer: {
      supportsComposer: true,
      allowedStatuses: READY_STATUSES,
      pasteKeySequence: (platform) =>
        platform === "darwin" ? "\u001bv" : "\u0016",
      imageFallback: "image-path",
      pasteDelayMs: 120,
    },
  },
  codex: {
    type: "codex",
    launch: {
      shell: "codex",
      resumeArgs: (id) => ["resume", id],
      newArgs: () => [],
    },
    composer: {
      supportsComposer: true,
      allowedStatuses: READY_STATUSES,
      pasteKeySequence: () => "\u0016",
      imageFallback: "error",
      pasteDelayMs: 120,
    },
  },
  kimi: {
    type: "kimi",
    launch: {
      shell: "kimi",
      resumeArgs: (id) => ["-S", id],
      newArgs: () => [],
    },
    composer: NO_COMPOSER,
  },
  gemini: {
    type: "gemini",
    launch: {
      shell: "gemini",
      resumeArgs: (id) => ["--resume", id],
      newArgs: () => [],
    },
    composer: NO_COMPOSER,
  },
  opencode: {
    type: "opencode",
    launch: {
      shell: "opencode",
      resumeArgs: (id) => ["-s", id],
      newArgs: () => [],
    },
    composer: NO_COMPOSER,
  },
  lazygit: {
    type: "lazygit",
    launch: {
      shell: "lazygit",
      resumeArgs: () => [],
      newArgs: () => [],
    },
    composer: NO_COMPOSER,
  },
  tmux: {
    type: "tmux",
    launch: {
      shell: "tmux",
      resumeArgs: (name) => ["attach", "-t", name],
      newArgs: () => [],
    },
    composer: NO_COMPOSER,
  },
};

export function getTerminalLaunchOptions(
  type: TerminalType,
  sessionId: string | undefined,
): { shell: string; args: string[] } | null {
  const config = TERMINAL_CONFIG[type].launch;
  if (!config) return null;

  return {
    shell: config.shell,
    args: sessionId ? config.resumeArgs(sessionId) : config.newArgs(),
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
  return type === "claude" || type === "codex";
}
