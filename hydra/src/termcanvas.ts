import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { HydraError } from "./errors.ts";
import { resolveTermCanvasPortFile } from "../../shared/termcanvas-instance.ts";

export function getTermCanvasPortFile(
  env: Record<string, string | undefined> = process.env,
): string {
  return resolveTermCanvasPortFile(env);
}

export function isTermCanvasRunning(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    fs.readFileSync(getTermCanvasPortFile(env), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function parseJsonOrDie(stdout: string): any {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new HydraError(
      `Failed to parse TermCanvas response: ${stdout.slice(0, 200)}`,
      {
        errorCode: "TERMCANVAS_INVALID_JSON",
        stage: "termcanvas.parse_json",
        ids: {},
      },
    );
  }
}

export function buildTermcanvasArgs(
  group: string,
  command: string,
  args: string[],
): string[] {
  return [group, command, ...args, "--json"];
}

export function buildTerminalCreateArgs(
  worktreePath: string,
  type: string,
  prompt?: string,
  autoApprove?: boolean,
  parentTerminalId?: string,
  workflowId?: string,
  handoffId?: string,
  repoPath?: string,
): string[] {
  const args = ["--worktree", worktreePath, "--type", type];
  if (prompt) args.push("--prompt", prompt);
  if (autoApprove) args.push("--auto-approve");
  if (parentTerminalId) args.push("--parent-terminal", parentTerminalId);
  if (workflowId) args.push("--workflow-id", workflowId);
  if (handoffId) args.push("--handoff-id", handoffId);
  if (repoPath) args.push("--repo", repoPath);
  return buildTermcanvasArgs("terminal", "create", args);
}

export function buildTelemetryTerminalArgs(terminalId: string): string[] {
  return buildTermcanvasArgs("telemetry", "get", ["--terminal", terminalId]);
}

export function buildTelemetryWorkflowArgs(workflowId: string, repoPath: string): string[] {
  return buildTermcanvasArgs("telemetry", "get", ["--workflow", workflowId, "--repo", repoPath]);
}

export function buildTelemetryEventsArgs(
  terminalId: string,
  limit = 50,
  cursor?: string,
): string[] {
  const args = ["--terminal", terminalId, "--limit", String(limit)];
  if (cursor) args.push("--cursor", cursor);
  return buildTermcanvasArgs("telemetry", "events", args);
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
    throw new HydraError(`termcanvas ${args.slice(0, 2).join(" ")} failed: ${detail}`, {
      errorCode: "TERMCANVAS_COMMAND_FAILED",
      stage: "termcanvas.exec",
      ids: {
        command: args.slice(0, 2).join("."),
      },
    });
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

export function terminalCreate(
  worktreePath: string,
  type: string,
  prompt?: string,
  autoApprove?: boolean,
  parentTerminalId?: string,
  workflowId?: string,
  handoffId?: string,
  repoPath?: string,
): { id: string; type: string; title: string } {
  return runTermcanvasJson(
    buildTerminalCreateArgs(
      worktreePath,
      type,
      prompt,
      autoApprove,
      parentTerminalId,
      workflowId,
      handoffId,
      repoPath,
    ),
    10_000,
  );
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

export function telemetryTerminal(terminalId: string): any {
  return runTermcanvasJson(buildTelemetryTerminalArgs(terminalId), 10_000);
}

export function telemetryWorkflow(workflowId: string, repoPath: string): any {
  return runTermcanvasJson(buildTelemetryWorkflowArgs(workflowId, repoPath), 10_000);
}

export function telemetryEvents(terminalId: string, limit = 50, cursor?: string): any {
  return runTermcanvasJson(buildTelemetryEventsArgs(terminalId, limit, cursor), 10_000);
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
