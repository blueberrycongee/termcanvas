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
  [/\baider\b/, "aider"],
  [/\bamp\b/, "amp"],
  [/\broo\b/, "roocode"],
  [/\blazygit\b/, "lazygit"],
  [/\btmux\b/, "tmux"],
];

// Wrappers that delegate to another binary — check subsequent args for the real CLI
const WRAPPER_NAMES = new Set(["node", "bun", "npx", "bunx"]);

function matchCli(args: string): string | null {
  // Extract the process name (first token)
  const firstToken = args.split(/\s+/)[0];
  const baseName = firstToken.split("/").pop() ?? "";

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
  // `queue` was populated by BFS so its order reflects tree depth.
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
 * Detect a CLI tool running as a descendant of the given shell PID.
 * Returns the CLI type and optional session name (for tmux).
 */
export async function detectCli(
  shellPid: number,
): Promise<{ cliType: string; pid?: number; sessionName?: string } | null> {
  const psOutput = await new Promise<string>((resolve, reject) => {
    execFile("ps", ["-eo", "pid,ppid,args"], (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });

  const results = parsePsOutput(psOutput, [shellPid]);
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
