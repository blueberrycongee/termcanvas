import fs from "node:fs";
import path from "node:path";
import { collectTaskPackage, type CollectTaskPackageResult } from "./collector.ts";
import type { HandoffContract, ResultContract } from "./protocol.ts";
import { loadAgent, type AgentRecord } from "./store.ts";
import { enrichWorkflowStatusView } from "./telemetry.ts";
import { isTermCanvasRunning, telemetryTerminal } from "./termcanvas.ts";
import { watchWorkflow } from "./workflow.ts";

// ── Agent watch types ──

export interface AgentStatusView {
  agent: {
    id: string;
    status: "running" | "completed" | "failed";
    task: string;
    type: string;
    terminalId: string;
    worktreePath: string;
  };
  result?: ResultContract;
  failure?: { code: string; message: string; stage: string };
}

export interface WatchAgentOptions {
  agentId: string;
  intervalMs: number;
  timeoutMs?: number;
}

export interface WatchAgentDependencies {
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  loadAgent?: (id: string) => AgentRecord | null;
  checkTerminalAlive?: (terminalId: string) => boolean | null;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultCheckTerminalAlive(terminalId: string): boolean | null {
  try {
    if (!isTermCanvasRunning()) return null;
    const telemetry = telemetryTerminal(terminalId);
    return telemetry?.pty_alive ?? null;
  } catch {
    return null;
  }
}

function readHandoffContract(filePath: string): HandoffContract | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as HandoffContract;
  } catch {
    return null;
  }
}

function buildStatusView(agent: AgentRecord, collected: CollectTaskPackageResult): AgentStatusView {
  const base = {
    id: agent.id,
    task: agent.task,
    type: agent.type,
    terminalId: agent.terminalId,
    worktreePath: agent.worktreePath,
  };

  if (collected.status === "completed") {
    return { agent: { ...base, status: "completed" }, result: collected.result };
  }
  if (collected.status === "failed") {
    return { agent: { ...base, status: "failed" }, failure: collected.failure };
  }
  return { agent: { ...base, status: "running" } };
}

export async function watchAgent(
  options: WatchAgentOptions,
  dependencies: WatchAgentDependencies = {},
): Promise<AgentStatusView> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const sleep = dependencies.sleep ?? DEFAULT_SLEEP;
  const load = dependencies.loadAgent ?? loadAgent;
  const checkAlive = dependencies.checkTerminalAlive ?? defaultCheckTerminalAlive;
  const startedAtMs = Date.parse(now());

  const agent = load(options.agentId);
  if (!agent) {
    return {
      agent: {
        id: options.agentId,
        status: "failed",
        task: "",
        type: "",
        terminalId: "",
        worktreePath: "",
      },
      failure: {
        code: "AGENT_NOT_FOUND",
        message: `Agent ${options.agentId} not found in registry`,
        stage: "watch.load_agent",
      },
    };
  }

  if (!agent.handoffFile) {
    return {
      agent: {
        id: agent.id, status: "failed", task: agent.task, type: agent.type,
        terminalId: agent.terminalId, worktreePath: agent.worktreePath,
      },
      failure: {
        code: "AGENT_NO_HANDOFF",
        message: `Agent ${agent.id} has no handoff file`,
        stage: "watch.load_handoff",
      },
    };
  }

  const contract = readHandoffContract(agent.handoffFile);
  if (!contract) {
    return {
      agent: {
        id: agent.id, status: "failed", task: agent.task, type: agent.type,
        terminalId: agent.terminalId, worktreePath: agent.worktreePath,
      },
      failure: {
        code: "AGENT_HANDOFF_UNREADABLE",
        message: `Cannot read handoff file: ${agent.handoffFile}`,
        stage: "watch.read_handoff",
      },
    };
  }

  while (true) {
    const collected = collectTaskPackage(contract);

    if (collected.status === "completed" || collected.status === "failed") {
      return buildStatusView(agent, collected);
    }

    // Terminal died without producing result → failed
    const alive = checkAlive(agent.terminalId);
    if (alive === false) {
      return {
        agent: {
          id: agent.id, status: "failed", task: agent.task, type: agent.type,
          terminalId: agent.terminalId, worktreePath: agent.worktreePath,
        },
        failure: {
          code: "AGENT_TERMINAL_DEAD",
          message: `Terminal ${agent.terminalId} is no longer running`,
          stage: "watch.check_terminal",
        },
      };
    }

    // Timeout check
    const elapsedMs = Date.parse(now()) - startedAtMs;
    if (options.timeoutMs !== undefined && elapsedMs >= options.timeoutMs) {
      return buildStatusView(agent, collected);
    }

    await sleep(options.intervalMs);
  }
}

// ── CLI interface ──

export interface WatchArgs {
  repo?: string;
  workflow?: string;
  agent?: string;
  intervalMs: number;
  timeoutMs?: number;
}

function printWatchUsage(): never {
  console.log("Usage: hydra watch --workflow <id> --repo <path>");
  console.log("       hydra watch --agent <id>");
  console.log("");
  console.log("Options:");
  console.log("  --workflow <id>      Watch a workflow run (requires --repo)");
  console.log("  --agent <id>         Watch a spawned agent");
  console.log("  --repo <path>        Repository path (required for --workflow)");
  console.log("  --interval-ms <num>  Polling interval in milliseconds (default: 30000)");
  console.log("  --timeout-ms <num>   Stop watching after this many milliseconds (default: 3600000)");
  process.exit(0);
}

export function parseWatchArgs(args: string[]): WatchArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printWatchUsage();
  }

  const result: Partial<WatchArgs> = {
    intervalMs: 30_000,
    timeoutMs: 3_600_000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--repo" && i + 1 < args.length) {
      result.repo = args[++i];
    } else if (arg === "--workflow" && i + 1 < args.length) {
      result.workflow = args[++i];
    } else if (arg === "--agent" && i + 1 < args.length) {
      result.agent = args[++i];
    } else if (arg === "--interval-ms" && i + 1 < args.length) {
      result.intervalMs = Number.parseInt(args[++i], 10);
    } else if (arg === "--timeout-ms" && i + 1 < args.length) {
      result.timeoutMs = Number.parseInt(args[++i], 10);
    }
  }

  if (!result.workflow && !result.agent) {
    throw new Error("Missing required flag: --workflow or --agent");
  }
  if (result.workflow && !result.repo) {
    throw new Error("Missing required flag: --repo (required with --workflow)");
  }
  if (!Number.isFinite(result.intervalMs) || (result.intervalMs ?? 0) <= 0) {
    throw new Error("Expected --interval-ms to be a positive integer");
  }
  if (result.timeoutMs !== undefined && (!Number.isFinite(result.timeoutMs) || result.timeoutMs <= 0)) {
    throw new Error("Expected --timeout-ms to be a positive integer");
  }

  return result as WatchArgs;
}

export async function watch(args: string[]): Promise<void> {
  const parsed = parseWatchArgs(args);

  if (parsed.agent) {
    const result = await watchAgent({
      agentId: parsed.agent,
      intervalMs: parsed.intervalMs,
      timeoutMs: parsed.timeoutMs,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Workflow watch (existing path)
  const result = enrichWorkflowStatusView(await watchWorkflow({
    repoPath: path.resolve(parsed.repo!),
    workflowId: parsed.workflow!,
    intervalMs: parsed.intervalMs,
    timeoutMs: parsed.timeoutMs,
  }));
  console.log(JSON.stringify(result, null, 2));
}
