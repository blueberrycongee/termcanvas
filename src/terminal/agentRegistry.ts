/**
 * Central agent registry — the single source of truth for all supported
 * AI coding agents and tool types in TermCanvas.
 *
 * To add a new agent:
 *   1. Add an entry to AGENT_REGISTRY below.
 *   2. That's it. The rest of the app reads from this registry.
 */

export interface AgentDefinition {
  /** Unique identifier used as the TerminalType discriminator. */
  id: string;
  /** Human-readable display name. */
  label: string;
  /** Accent color for the terminal tile badge. */
  color: string;
  /** CLI command name (used for process detection and launch). */
  command: string;
  /** Regex pattern to match the process name in `ps` output. */
  detectPattern: RegExp;
  /**
   * Whether this agent is an AI coding agent (shown in Settings > Agents).
   * Non-agent tools like lazygit/tmux/shell are `false`.
   */
  isAgent: boolean;
  /** Whether this type supports session resume. */
  supportsResume: boolean;
}

/**
 * Ordered list of all known terminal types.
 * The order matters for process detection: first match wins.
 *
 * NOTE: "shell" is intentionally excluded — it's the default fallback
 * and has no CLI detection pattern.
 */
export const AGENT_REGISTRY: readonly AgentDefinition[] = [
  {
    id: "claude",
    label: "Claude",
    color: "#f5a623",
    command: "claude",
    detectPattern: /\bclaude\b/,
    isAgent: true,
    supportsResume: true,
  },
  {
    id: "codex",
    label: "Codex",
    color: "#7928ca",
    command: "codex",
    detectPattern: /\bcodex\b/,
    isAgent: true,
    supportsResume: true,
  },
  {
    id: "kimi",
    label: "Kimi",
    color: "#0070f3",
    command: "kimi",
    detectPattern: /\bkimi\b/,
    isAgent: true,
    supportsResume: true,
  },
  {
    id: "gemini",
    label: "Gemini",
    color: "#4285f4",
    command: "gemini",
    detectPattern: /\bgemini\b/,
    isAgent: true,
    supportsResume: true,
  },
  {
    id: "opencode",
    label: "OpenCode",
    color: "#50e3c2",
    command: "opencode",
    detectPattern: /\bopencode\b/,
    isAgent: true,
    supportsResume: true,
  },
  {
    id: "aider",
    label: "Aider",
    color: "#14b8a6",
    command: "aider",
    detectPattern: /\baider\b/,
    isAgent: true,
    supportsResume: false,
  },
  {
    id: "amp",
    label: "Amp",
    color: "#6366f1",
    command: "amp",
    detectPattern: /\bamp\b/,
    isAgent: true,
    supportsResume: false,
  },
  {
    id: "roocode",
    label: "Roo Code",
    color: "#ec4899",
    command: "roo",
    detectPattern: /\broo\b/,
    isAgent: true,
    supportsResume: false,
  },
  // Non-agent tools
  {
    id: "lazygit",
    label: "Lazygit",
    color: "#e84d31",
    command: "lazygit",
    detectPattern: /\blazygit\b/,
    isAgent: false,
    supportsResume: false,
  },
  {
    id: "tmux",
    label: "Tmux",
    color: "#1bb91f",
    command: "tmux",
    detectPattern: /\btmux\b/,
    isAgent: false,
    supportsResume: false,
  },
] as const;

// --- Derived lookups (computed once) ---

/** Map from agent id to its definition. */
export const AGENT_BY_ID = new Map<string, AgentDefinition>(
  AGENT_REGISTRY.map((a) => [a.id, a]),
);

/** Only the AI coding agents (for Settings > Agents tab). */
export const AI_AGENTS = AGENT_REGISTRY.filter((a) => a.isAgent);

/** All valid terminal type IDs including "shell". */
export const ALL_TERMINAL_TYPE_IDS = [
  "shell",
  ...AGENT_REGISTRY.map((a) => a.id),
] as const;

/** Type-safe label lookup including "shell". */
export function getAgentLabel(id: string): string {
  if (id === "shell") return "Shell";
  return AGENT_BY_ID.get(id)?.label ?? id;
}

/** Type-safe color lookup including "shell". */
export function getAgentColor(id: string): string {
  if (id === "shell") return "#888";
  return AGENT_BY_ID.get(id)?.color ?? "#888";
}
