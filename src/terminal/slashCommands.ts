import type { TerminalType } from "../types";

export interface SlashCommand {
  command: string;
  description: string;
}

const CLAUDE_COMMANDS: readonly SlashCommand[] = [
  { command: "/help", description: "Show help and available commands" },
  { command: "/config", description: "View or update configuration" },
  { command: "/cost", description: "Show token usage and cost" },
  { command: "/compact", description: "Compact conversation history" },
  { command: "/clear", description: "Clear conversation" },
  { command: "/doctor", description: "Check for common issues" },
  { command: "/init", description: "Initialize project configuration" },
  { command: "/login", description: "Sign in to your account" },
  { command: "/logout", description: "Sign out" },
  { command: "/mcp", description: "Manage MCP servers" },
  { command: "/memory", description: "Edit CLAUDE.md memory files" },
  { command: "/model", description: "Switch AI model" },
  { command: "/permissions", description: "View or update permissions" },
  { command: "/review", description: "Review a pull request" },
  { command: "/status", description: "Show status information" },
  { command: "/terminal-setup", description: "Set up terminal integration" },
  { command: "/skills", description: "List available skills" },
  { command: "/vim", description: "Toggle vim mode" },
] as const;

const CODEX_COMMANDS: readonly SlashCommand[] = [
  { command: "/help", description: "Show help" },
  { command: "/model", description: "Switch model" },
  { command: "/approval", description: "Set approval mode" },
  { command: "/provider", description: "Switch provider" },
  { command: "/history", description: "Show conversation history" },
  { command: "/compact", description: "Compact conversation" },
  { command: "/clear", description: "Clear conversation" },
  { command: "/skills", description: "Use skills to improve how Codex performs specific tasks" },
] as const;

const NO_COMMANDS: readonly SlashCommand[] = [];

const COMMANDS_BY_TYPE: Record<TerminalType, readonly SlashCommand[]> = {
  claude: CLAUDE_COMMANDS,
  codex: CODEX_COMMANDS,
  shell: NO_COMMANDS,
  kimi: NO_COMMANDS,
  gemini: NO_COMMANDS,
  opencode: NO_COMMANDS,
  lazygit: NO_COMMANDS,
  tmux: NO_COMMANDS,
};

export function getSlashCommands(type: TerminalType): readonly SlashCommand[] {
  return COMMANDS_BY_TYPE[type];
}

export function filterSlashCommands(
  type: TerminalType,
  query: string,
): readonly SlashCommand[] {
  const commands = COMMANDS_BY_TYPE[type];
  if (query.length === 0) return commands;

  const lower = query.toLowerCase();
  return commands.filter((cmd) => cmd.command.toLowerCase().includes(lower));
}
