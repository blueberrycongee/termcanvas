import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT_FILE = path.join(os.homedir(), ".termcanvas", "port");

export function isTermCanvasRunning(): boolean {
  try {
    fs.readFileSync(PORT_FILE, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function parseJsonOrDie(stdout: string): any {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Failed to parse TermCanvas response: ${stdout.slice(0, 200)}`);
  }
}

export function buildTermcanvasArgs(
  group: string,
  command: string,
  args: string[],
): string[] {
  return [group, command, ...args, "--json"];
}

export function buildTerminalCreateArgs(worktreePath: string, type: string, prompt?: string, autoApprove?: boolean, parentTerminalId?: string): string[] {
  const args = ["--worktree", worktreePath, "--type", type];
  if (prompt) args.push("--prompt", prompt);
  if (autoApprove) args.push("--auto-approve");
  if (parentTerminalId) args.push("--parent-terminal", parentTerminalId);
  return buildTermcanvasArgs("terminal", "create", args);
}

export function buildTerminalInputArgs(terminalId: string, text: string): string[] {
  return buildTermcanvasArgs("terminal", "input", [terminalId, text]);
}

function runTermcanvasJson(args: string[], timeout: number): any {
  let stdout: string;
  try {
    stdout = execFileSync("termcanvas", args, {
      encoding: "utf-8",
      timeout,
    });
  } catch (err: any) {
    // execFileSync puts stderr in err.stderr — surface it instead of the
    // generic "Command failed: ..." wrapper from Node.
    const detail = (err.stderr as string)?.trim() || err.message;
    throw new Error(`termcanvas ${args.slice(0, 2).join(" ")} failed: ${detail}`);
  }
  return parseJsonOrDie(stdout);
}

function tc(group: string, command: string, args: string[] = []): any {
  return runTermcanvasJson(buildTermcanvasArgs(group, command, args), 10_000);
}

export function projectList(): any[] {
  return tc("project", "list");
}

export function projectRescan(projectId: string): void {
  tc("project", "rescan", [projectId]);
}

export function terminalCreate(worktreePath: string, type: string, prompt?: string, autoApprove?: boolean, parentTerminalId?: string): { id: string; type: string; title: string } {
  return runTermcanvasJson(buildTerminalCreateArgs(worktreePath, type, prompt, autoApprove, parentTerminalId), 10_000);
}

export function terminalStatus(terminalId: string): { id: string; status: string; ptyId: number | null } {
  return tc("terminal", "status", [terminalId]);
}

export function terminalInput(terminalId: string, text: string): void {
  runTermcanvasJson(buildTerminalInputArgs(terminalId, text), 5_000);
}

export function terminalDestroy(terminalId: string): void {
  tc("terminal", "destroy", [terminalId]);
}

export function findProjectByPath(repoPath: string): { id: string; path: string } | null {
  const abs = path.resolve(repoPath);
  const projects = projectList();
  for (const p of projects) {
    if (p.path === abs) return { id: p.id, path: p.path };
    for (const w of p.worktrees ?? []) {
      if (w.path === abs) return { id: p.id, path: p.path };
    }
  }
  return null;
}
