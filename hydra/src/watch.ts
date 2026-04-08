import crypto from "node:crypto";
import {
  dispatchCreateOnly as defaultDispatchCreateOnly,
  type DispatchCreateOnlyRequest,
  type DispatchCreateOnlyResult,
} from "./dispatcher.ts";
import { collectRunResult } from "./collector.ts";
import { getRunResultFile } from "./layout.ts";
import type { WorkflowResultContract } from "./protocol.ts";
import { loadAgent, saveAgent as defaultSaveAgent, type AgentRecord } from "./store.ts";
import { enrichWorkflowStatusView } from "./telemetry.ts";
import { isTermCanvasRunning, telemetryTerminal } from "./termcanvas.ts";
import { writeRunTask } from "./run-task.ts";
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
  result?: WorkflowResultContract;
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

function generateRunId(): string {
  return `run-${crypto.randomBytes(6).toString("hex")}`;
}

function writeDirectWorkerRun(agent: AgentRecord, runId: string) {
  return writeRunTask({
    repoPath: agent.repo,
    workflowId: agent.workflowId!,
    assignmentId: agent.assignmentId!,
    runId,
    role: "implementer",
    agentType: agent.type,
    sourceRole: "orchestrator",
    objective: [agent.task],
    readFiles: [],
    writeTargets: [
      {
        label: "Result JSON",
        path: getRunResultFile(agent.repo, agent.workflowId!, agent.assignmentId!, runId),
      },
    ],
    decisionRules: [
      "- Complete the requested task honestly.",
      "- Use next_action.type=complete when the worker is actually done.",
    ],
    acceptanceCriteria: [
      "Complete the requested task",
      "Write a valid result.json file",
    ],
    skills: [],
  });
}

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

function buildStatusView(
  agent: AgentRecord,
  status:
    | { kind: "completed"; result: WorkflowResultContract }
    | { kind: "failed"; failure: { code: string; message: string; stage: string } }
    | { kind: "running" },
  telemetryData?: AgentStatusView["telemetry"],
): AgentStatusView {
  const base = {
    id: agent.id,
    task: agent.task,
    type: agent.type,
    terminalId: agent.terminalId,
    worktreePath: agent.worktreePath,
  };

  if (status.kind === "completed") {
    return { agent: { ...base, status: "completed" }, result: status.result };
  }
  if (status.kind === "failed") {
    return { agent: { ...base, status: "failed" }, failure: status.failure };
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

  if (!agent.workflowId || !agent.assignmentId || !agent.runId || !agent.taskFile || !agent.resultFile) {
    return {
      agent: {
        id: agent.id,
        status: "failed",
        task: agent.task,
        type: agent.type,
        terminalId: agent.terminalId,
        worktreePath: agent.worktreePath,
      },
      failure: {
        code: "AGENT_RUNTIME_METADATA_MISSING",
        message: `Agent ${agent.id} is missing workflow/assignment/run metadata`,
        stage: "watch.agent_metadata",
      },
    };
  }

  let retryCount = 0;

  while (true) {
    const collected = collectRunResult({
      workflow_id: agent.workflowId,
      assignment_id: agent.assignmentId,
      run_id: agent.runId,
      result_file: agent.resultFile,
    });

    if (collected.status === "completed") {
      return buildStatusView(agent, { kind: "completed", result: collected.result });
    }
    if (collected.status === "failed") {
      return buildStatusView(agent, { kind: "failed", failure: collected.failure });
    }

    let telemetryData: AgentStatusView["telemetry"];
    try {
      const telemetry = getTelemetry(agent.terminalId);
      if (telemetry) {
        telemetryData = {
          turn_state: telemetry.turn_state,
          foreground_tool: telemetry.foreground_tool,
          last_meaningful_progress_at: telemetry.last_meaningful_progress_at,
        };
      }
    } catch {}

    const alive = checkAlive(agent.terminalId);
    if (alive === false) {
      if (retryCount >= maxRetries) {
        return buildStatusView(agent, {
          kind: "failed",
          failure: {
            code: "AGENT_TERMINAL_DEAD",
            message: `Terminal ${agent.terminalId} is no longer running (retries exhausted: ${retryCount}/${maxRetries})`,
            stage: "watch.check_terminal",
          },
        });
      }

      retryCount++;
      const nextRunId = generateRunId();
      const nextRun = writeDirectWorkerRun(agent, nextRunId);
      const dispatched = await dispatch({
        workflowId: agent.workflowId,
        assignmentId: agent.assignmentId,
        runId: nextRunId,
        repoPath: agent.repo,
        worktreePath: agent.worktreePath,
        agentType: agent.type,
        taskFile: nextRun.task_file,
        resultFile: nextRun.result_file,
        autoApprove: true,
        parentTerminalId: process.env.TERMCANVAS_TERMINAL_ID,
      });
      agent.runId = nextRunId;
      agent.taskFile = nextRun.task_file;
      agent.resultFile = nextRun.result_file;
      agent.terminalId = dispatched.terminalId;
      save(agent);
      continue;
    }

    const elapsedMs = Date.parse(now()) - startedAtMs;
    if (options.timeoutMs !== undefined && elapsedMs >= options.timeoutMs) {
      return buildStatusView(agent, { kind: "running" }, telemetryData);
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

  if (!parsed.repo || !parsed.workflow) {
    printWatchUsage();
  }

  const result = enrichWorkflowStatusView(await watchWorkflow({
    repoPath: parsed.repo!,
    workflowId: parsed.workflow!,
    intervalMs: parsed.intervalMs,
    timeoutMs: parsed.timeoutMs,
  }));
  console.log(JSON.stringify(result, null, 2));
}
