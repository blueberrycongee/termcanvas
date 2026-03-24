import { execFile } from "child_process";

export interface DetectedCli {
  pid: number;
  cliType: string;
  args: string;
}

// CLI names we recognise. Order matters: first match wins.
const CLI_PATTERNS: [RegExp, string][] = [
  [/\bclaude\b/, "claude"],
  [/\bcodex\b/, "codex"],
  [/\bkimi\b/, "kimi"],
  [/\bgemini\b/, "gemini"],
  [/\bopencode\b/, "opencode"],
  [/\blazygit\b/, "lazygit"],
  [/\btmux\b/, "tmux"],
];

// Wrappers that delegate to another binary — check subsequent args for the real CLI
const WRAPPER_NAMES = new Set(["node", "bun", "npx", "bunx"]);

function normalizeProcessName(token: string): string {
  const trimmed = token.replace(/^"|"$/g, "");
  const baseName = trimmed.split(/[\\/]/).pop() ?? "";
  return baseName.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

function extractFirstToken(args: string): string {
  const match = args.match(/^"([^"]+)"|^(\S+)/);
  return match?.[1] ?? match?.[2] ?? "";
}

function matchCli(args: string): string | null {
  // Extract the process name (first token)
  const firstToken = extractFirstToken(args);
  const baseName = normalizeProcessName(firstToken);

  // If the process is a wrapper (node, bun, npx, bunx), match against the full args string
  // to catch patterns like `node /usr/local/bin/claude` or `npx codex`
  if (WRAPPER_NAMES.has(baseName)) {
    // Skip the wrapper name and match the rest
    const rest = args.slice(firstToken.length);
    for (const [pattern, cliType] of CLI_PATTERNS) {
      if (pattern.test(rest)) return cliType;
    }
    return null;
  }

  // Direct execution: match just the base process name
  for (const [pattern, cliType] of CLI_PATTERNS) {
    if (pattern.test(baseName)) return cliType;
  }
  return null;
}

function collectDetectedClis(
  processes: { pid: number; ppid: number; args: string }[],
  shellPids: number[],
): DetectedCli[] {
  // Build parent → children map
  const childrenOf = new Map<number, number[]>();
  for (const p of processes) {
    let siblings = childrenOf.get(p.ppid);
    if (!siblings) {
      siblings = [];
      childrenOf.set(p.ppid, siblings);
    }
    siblings.push(p.pid);
  }

  // BFS: collect all descendant PIDs
  const descendants = new Set<number>();
  const queue = [...shellPids];
  let qi = 0;
  while (qi < queue.length) {
    const children = childrenOf.get(queue[qi++]);
    if (!children) continue;
    for (const child of children) {
      if (!descendants.has(child)) {
        descendants.add(child);
        queue.push(child);
      }
    }
  }

  // Match CLIs among descendants in BFS order (shallowest first).
  const processMap = new Map(processes.map((p) => [p.pid, p]));
  const results: DetectedCli[] = [];
  for (const pid of queue.slice(shellPids.length)) {
    const proc = processMap.get(pid);
    if (!proc) continue;
    const cliType = matchCli(proc.args);
    if (cliType) {
      results.push({ pid: proc.pid, cliType, args: proc.args });
    }
  }

  return results;
}

/**
 * Parse `ps -eo pid,ppid,args` output and find CLI processes
 * among all descendants (not just direct children) of the given shell PIDs.
 * Uses BFS so shallower matches appear first in results.
 */
export function parsePsOutput(psOutput: string, shellPids: number[]): DetectedCli[] {
  const processes: { pid: number; ppid: number; args: string }[] = [];
  const lines = psOutput.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("PID")) continue;

    // Format: "  PID  PPID ARGS..."
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;

    processes.push({
      pid: parseInt(match[1], 10),
      ppid: parseInt(match[2], 10),
      args: match[3],
    });
  }

  return collectDetectedClis(processes, shellPids);
}

export function parseWindowsProcessListOutput(
  processJson: string,
  shellPids: number[],
): DetectedCli[] {
  if (!processJson.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(processJson);
  } catch {
    return [];
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const processes: { pid: number; ppid: number; args: string }[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as {
      ProcessId?: unknown;
      ParentProcessId?: unknown;
      CommandLine?: unknown;
    };
    if (
      typeof row.ProcessId !== "number" ||
      typeof row.ParentProcessId !== "number" ||
      typeof row.CommandLine !== "string" ||
      row.CommandLine.trim().length === 0
    ) {
      continue;
    }

    processes.push({
      pid: row.ProcessId,
      ppid: row.ParentProcessId,
      args: row.CommandLine,
    });
  }

  return collectDetectedClis(processes, shellPids);
}

export function getProcessListCommand(
  platform = process.platform,
): { command: string; args: string[] } {
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
    };
  }

  return {
    command: "ps",
    args: ["-eo", "pid,ppid,args"],
  };
}

/**
 * Detect a CLI tool running as a descendant of the given shell PID.
 * Returns the CLI type and optional session name (for tmux).
 */
export async function detectCli(
  shellPid: number,
): Promise<{ cliType: string; pid?: number; sessionName?: string } | null> {
  const processListCommand = getProcessListCommand();
  const processOutput = await new Promise<string>((resolve, reject) => {
    execFile(processListCommand.command, processListCommand.args, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });

  const results = process.platform === "win32"
    ? parseWindowsProcessListOutput(processOutput, [shellPid])
    : parsePsOutput(processOutput, [shellPid]);
  if (results.length === 0) return null;

  const first = results[0];

  if (first.cliType === "tmux") {
    // Get the tmux session name
    try {
      const sessionName = await new Promise<string>((resolve, reject) => {
        execFile("tmux", ["display-message", "-p", "#S"], (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout.trim());
        });
      });
      return { cliType: "tmux", pid: first.pid, sessionName };
    } catch {
      return { cliType: "tmux", pid: first.pid };
    }
  }

  return { cliType: first.cliType, pid: first.pid };
}
