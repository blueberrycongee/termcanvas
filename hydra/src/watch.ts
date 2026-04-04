import fs from "node:fs";
import path from "node:path";
import { collectTaskPackage, type CollectTaskPackageResult } from "./collector.ts";
import {
  dispatchCreateOnly as defaultDispatchCreateOnly,
  type DispatchCreateOnlyRequest,
  type DispatchCreateOnlyResult,
} from "./dispatcher.ts";
import type { HandoffContract, ResultContract } from "./protocol.ts";
import { loadAgent, saveAgent as defaultSaveAgent, type AgentRecord } from "./store.ts";
import { enrichWorkflowStatusView } from "./telemetry.ts";
import { isTermCanvasRunning, telemetryTerminal } from "./termcanvas.ts";
import { watchWorkflow } from "./workflow.ts";

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
  telemetry?: {
    turn_state?: string;
    foreground_tool?: string;
    last_meaningful_progress_at?: string;
  };
}

export interface WatchAgentOptions {
  agentId: string;
  intervalMs: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface WatchAgentDependencies {
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  loadAgent?: (id: string) => AgentRecord | null;
  checkTerminalAlive?: (terminalId: string) => boolean | null;
  telemetryTerminal?: (terminalId: string) => any;
  dispatchCreateOnly?: (request: DispatchCreateOnlyRequest) => Promise<DispatchCreateOnlyResult>;
  saveAgent?: (record: AgentRecord) => void;
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

function defaultAgentTelemetry(terminalId: string): any {
  if (!isTermCanvasRunning()) return null;
  return telemetryTerminal(terminalId);
}

function readHandoffContract(filePath: string): HandoffContract | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as HandoffContract;
  } catch {
    return null;
  }
}

function buildStatusView(
  agent: AgentRecord,
  collected: CollectTaskPackageResult,
  telemetryData?: AgentStatusView["telemetry"],
): AgentStatusView {
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
  return { agent: { ...base, status: "running" }, telemetry: telemetryData };
}

export async function watchAgent(
  options: WatchAgentOptions,
  dependencies: WatchAgentDependencies = {},
): Promise<AgentStatusView> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const sleep = dependencies.sleep ?? DEFAULT_SLEEP;
  const load = dependencies.loadAgent ?? loadAgent;
  const checkAlive = dependencies.checkTerminalAlive ?? defaultCheckTerminalAlive;
  const getTelemetry = dependencies.telemetryTerminal ?? defaultAgentTelemetry;
  const dispatch = dependencies.dispatchCreateOnly ?? defaultDispatchCreateOnly;
  const save = dependencies.saveAgent ?? defaultSaveAgent;
  const maxRetries = options.maxRetries ?? 1;
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

  let retryCount = 0;

  while (true) {
    const collected = collectTaskPackage(contract);

    if (collected.status === "completed" || collected.status === "failed") {
      return buildStatusView(agent, collected);
    }

    // Enrich running state with telemetry
    let telemetryData: AgentStatusView["telemetry"];
    try {
      const t = getTelemetry(agent.terminalId);
      if (t) {
        telemetryData = {
          turn_state: t.turn_state,
          foreground_tool: t.foreground_tool,
          last_meaningful_progress_at: t.last_meaningful_progress_at,
        };
      }
    } catch {
      // Telemetry unavailable — continue without it
    }

    // Terminal died without producing result → retry or fail
    const alive = checkAlive(agent.terminalId);
    if (alive === false) {
      if (
        retryCount >= maxRetries ||
        !agent.workflowId || !agent.handoffId ||
        !agent.taskFile || !agent.doneFile || !agent.resultFile
      ) {
        return {
          agent: {
            id: agent.id, status: "failed", task: agent.task, type: agent.type,
            terminalId: agent.terminalId, worktreePath: agent.worktreePath,
          },
          failure: {
            code: "AGENT_TERMINAL_DEAD",
            message: `Terminal ${agent.terminalId} is no longer running (retries exhausted: ${retryCount}/${maxRetries})`,
            stage: "watch.check_terminal",
          },
        };
      }

      retryCount++;
      const dispatched = await dispatch({
        workflowId: agent.workflowId,
        handoffId: agent.handoffId,
        repoPath: agent.repo,
        worktreePath: agent.worktreePath,
        agentType: agent.type,
        taskFile: agent.taskFile,
        doneFile: agent.doneFile,
        resultFile: agent.resultFile,
        autoApprove: true,
        parentTerminalId: process.env.TERMCANVAS_TERMINAL_ID,
      });
      agent.terminalId = dispatched.terminalId;
      save(agent);
      continue;
    }

    // Timeout check
    const elapsedMs = Date.parse(now()) - startedAtMs;
    if (options.timeoutMs !== undefined && elapsedMs >= options.timeoutMs) {
      return buildStatusView(agent, collected, telemetryData);
    }

    await sleep(options.intervalMs);
  }
}

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

  const result = enrichWorkflowStatusView(await watchWorkflow({
    repoPath: path.resolve(parsed.repo!),
    workflowId: parsed.workflow!,
    intervalMs: parsed.intervalMs,
    timeoutMs: parsed.timeoutMs,
  }));
  console.log(JSON.stringify(result, null, 2));
}
