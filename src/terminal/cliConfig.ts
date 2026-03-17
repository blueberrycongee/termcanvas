import type { TerminalType } from "../types";

interface TerminalLaunchConfig {
  shell: string;
  resumeArgs: (id: string) => string[];
  newArgs: () => string[];
}

const CLI_CONFIG: Partial<Record<TerminalType, TerminalLaunchConfig>> = {
  claude: {
    shell: "claude",
    resumeArgs: (id) => ["--resume", id],
    newArgs: () => [],
  },
  codex: {
    shell: "codex",
    resumeArgs: (id) => ["resume", id],
    newArgs: () => [],
  },
  kimi: {
    shell: "kimi",
    resumeArgs: (id) => ["-S", id],
    newArgs: () => [],
  },
  gemini: {
    shell: "gemini",
    resumeArgs: (id) => ["--resume", id],
    newArgs: () => [],
  },
  opencode: {
    shell: "opencode",
    resumeArgs: (id) => ["-s", id],
    newArgs: () => [],
  },
  lazygit: {
    shell: "lazygit",
    resumeArgs: () => [],
    newArgs: () => [],
  },
  tmux: {
    shell: "tmux",
    resumeArgs: (name) => ["attach", "-t", name],
    newArgs: () => [],
  },
};

export function getTerminalLaunchOptions(
  type: TerminalType,
  sessionId: string | undefined,
): { shell: string; args: string[] } | null {
  const config = CLI_CONFIG[type];
  if (!config) return null;

  return {
    shell: config.shell,
    args: sessionId
      ? config.resumeArgs(sessionId)
      : config.newArgs(),
  };
}
