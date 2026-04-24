import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  getComputerUseMcpConfigArgs,
  type ComputerUseMcpProvider,
} from "../../shared/computer-use-mcp";

const HELP_ARGS = new Set(["-h", "--help", "help", "-v", "--version", "version"]);

function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function defaultStateFilePath(): string {
  return path.join(os.homedir(), ".termcanvas", "computer-use", "state.json");
}

function resolveStateFilePath(): string | null {
  const configured = process.env.TERMCANVAS_COMPUTER_USE_STATE_FILE?.trim();
  const stateFilePath = configured || defaultStateFilePath();
  return fs.existsSync(stateFilePath) ? stateFilePath : null;
}

function resolveMcpServerPath(): string | null {
  const configured = process.env.TERMCANVAS_COMPUTER_USE_MCP_SERVER?.trim();
  if (configured && fs.existsSync(configured)) return configured;

  const dir = moduleDir();
  const candidates = [
    path.resolve(dir, "..", "..", "mcp-computer-use-server", "index.js"),
    path.resolve(dir, "..", "..", "mcp", "computer-use-server", "dist", "index.js"),
    path.resolve(dir, "..", "..", "dist-computer-use", "mcp-computer-use-server", "index.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function commandCandidates(command: string): string[] {
  if (process.platform !== "win32") return [command];

  const lower = command.toLowerCase();
  if (lower.endsWith(".exe") || lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return [command];
  }
  return [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command];
}

function normalizePathEntry(entry: string): string {
  const normalized = path.resolve(entry);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function resolveRealCommand(command: string): string | null {
  const shimDir = normalizePathEntry(moduleDir());
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of pathEntries) {
    if (normalizePathEntry(entry) === shimDir) continue;
    for (const candidateName of commandCandidates(command)) {
      const candidate = path.join(entry, candidateName);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Keep searching PATH.
      }
    }
  }

  return null;
}

function shouldInjectMcp(args: string[]): boolean {
  return !args.some((arg) => HELP_ARGS.has(arg));
}

function getInjectedArgs(
  provider: ComputerUseMcpProvider,
  args: string[],
): string[] {
  const stateFilePath = resolveStateFilePath();
  const mcpServerPath = resolveMcpServerPath();
  if (!stateFilePath || !mcpServerPath || !shouldInjectMcp(args)) {
    return args;
  }

  return [
    ...getComputerUseMcpConfigArgs(provider, {
      mcpServerPath,
      stateFilePath,
    }),
    ...args,
  ];
}

export function runAgentShim(provider: ComputerUseMcpProvider): never {
  const realCommand = resolveRealCommand(provider);
  if (!realCommand) {
    console.error(`TermCanvas could not find the real ${provider} executable in PATH.`);
    process.exit(127);
  }

  const args = getInjectedArgs(provider, process.argv.slice(2));
  const result = spawnSync(realCommand, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`${provider} failed to start: ${result.error.message}`);
    process.exit(127);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
  process.exit(result.status ?? 1);
}
