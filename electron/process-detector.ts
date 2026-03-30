import { execFile } from "child_process";

export interface DetectedCli {
  pid: number;
  cliType: string;
  args: string;
}

export interface ProcessEntry {
  pid: number;
  ppid: number;
  args: string;
}

export interface ProcessSnapshotEntry {
  pid: number;
  command: string;
  cliType: string | null;
  depth: number;
}

export interface ProcessSnapshot {
  descendantProcesses: ProcessSnapshotEntry[];
  foregroundTool: string | null;
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
const SHELL_NAMES = new Set([
  "bash",
  "cmd",
  "fish",
  "login",
  "powershell",
  "powershell.exe",
  "pwsh",
  "sh",
  "tmux",
  "zsh",
]);

function normalizeProcessName(token: string): string {
  const trimmed = token.replace(/^"|"$/g, "");
  const baseName = trimmed.split(/[\\/]/).pop() ?? "";
  return baseName.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

export function splitCommandLine(args: string): { command: string; rest: string } {
  const match = args.match(/^\s*(?:"([^"]+)"|(\S+))(.*)$/);
  return {
    command: match?.[1] ?? match?.[2] ?? "",
    rest: match?.[3]?.trimStart() ?? "",
  };
}

function matchCli(args: string): string | null {
  const { command, rest } = splitCommandLine(args);
  const baseName = normalizeProcessName(command);

  // If the process is a wrapper (node, bun, npx, bunx), match against the full args string
  // to catch patterns like `node /usr/local/bin/claude` or `npx codex`
  if (WRAPPER_NAMES.has(baseName)) {
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
  processes: ProcessEntry[],
  shellPids: number[],
): DetectedCli[] {
  return buildProcessSnapshotFromEntries(processes, shellPids).descendantProcesses
    .filter((process) => process.cliType)
    .map((process) => ({
      pid: process.pid,
      cliType: process.cliType!,
      args: process.command,
    }));
}

function collectDescendantProcesses(
  processes: ProcessEntry[],
  shellPids: number[],
): ProcessSnapshotEntry[] {
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
  const queue = shellPids.map((pid) => ({ pid, depth: 0 }));
  let qi = 0;
  while (qi < queue.length) {
    const current = queue[qi++];
    const children = childrenOf.get(current.pid);
    if (!children) continue;
    for (const child of children) {
      if (!descendants.has(child)) {
        descendants.add(child);
        queue.push({ pid: child, depth: current.depth + 1 });
      }
    }
  }

  // Match CLIs among descendants in BFS order (shallowest first).
  const processMap = new Map(processes.map((p) => [p.pid, p]));
  const results: ProcessSnapshotEntry[] = [];
  for (const entry of queue.slice(shellPids.length)) {
    const proc = processMap.get(entry.pid);
    if (!proc) continue;
    results.push({
      pid: proc.pid,
      command: proc.args,
      cliType: matchCli(proc.args),
      depth: entry.depth,
    });
  }

  return results;
}

function chooseForegroundTool(descendants: ProcessSnapshotEntry[]): string | null {
  if (descendants.length === 0) return null;
  for (let index = descendants.length - 1; index >= 0; index -= 1) {
    const candidate = descendants[index];
    const baseName = normalizeProcessName(splitCommandLine(candidate.command).command);
    if (!SHELL_NAMES.has(baseName)) {
      return candidate.command;
    }
  }

  const cliCandidate = descendants.find((process) => process.cliType);
  if (cliCandidate) return cliCandidate.command;

  const lastProcess = descendants[descendants.length - 1];
  const baseName = normalizeProcessName(splitCommandLine(lastProcess.command).command);
  return SHELL_NAMES.has(baseName) ? null : lastProcess.command;
}

export function buildProcessSnapshotFromEntries(
  processes: ProcessEntry[],
  shellPids: number[],
): ProcessSnapshot {
  const descendantProcesses = collectDescendantProcesses(processes, shellPids);
  return {
    descendantProcesses,
    foregroundTool: chooseForegroundTool(descendantProcesses),
  };
}

/**
 * Parse `ps -eo pid,ppid,args` output and find CLI processes
 * among all descendants (not just direct children) of the given shell PIDs.
 * Uses BFS so shallower matches appear first in results.
 */
export function parsePsOutput(psOutput: string, shellPids: number[]): DetectedCli[] {
  const processes: ProcessEntry[] = [];
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

export function parsePsSnapshot(psOutput: string, shellPids: number[]): ProcessSnapshot {
  const processes: ProcessEntry[] = [];
  for (const line of psOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("PID")) continue;
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    processes.push({
      pid: parseInt(match[1], 10),
      ppid: parseInt(match[2], 10),
      args: match[3],
    });
  }
  return buildProcessSnapshotFromEntries(processes, shellPids);
}

export function parseWindowsProcessListOutput(
  processJson: string,
  shellPids: number[],
): DetectedCli[] {
  return buildWindowsProcessSnapshot(processJson, shellPids).descendantProcesses
    .filter((process) => process.cliType)
    .map((process) => ({
      pid: process.pid,
      cliType: process.cliType!,
      args: process.command,
    }));
}

export function buildWindowsProcessSnapshot(
  processJson: string,
  shellPids: number[],
): ProcessSnapshot {
  if (!processJson.trim()) {
    return { descendantProcesses: [], foregroundTool: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(processJson);
  } catch {
    return { descendantProcesses: [], foregroundTool: null };
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const processes: ProcessEntry[] = [];

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

  return buildProcessSnapshotFromEntries(processes, shellPids);
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

export async function getProcessSnapshot(shellPid: number): Promise<ProcessSnapshot> {
  const processListCommand = getProcessListCommand();
  const processOutput = await new Promise<string>((resolve, reject) => {
    execFile(processListCommand.command, processListCommand.args, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });

  return process.platform === "win32"
    ? buildWindowsProcessSnapshot(processOutput, [shellPid])
    : parsePsSnapshot(processOutput, [shellPid]);
}
