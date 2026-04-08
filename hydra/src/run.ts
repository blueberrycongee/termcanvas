import path from "node:path";
import type { AgentType } from "./assignment/types.ts";
import {
  DEFAULT_AGENT_TYPE,
  resolveWorkflowAgentTypes,
  parseAgentTypeFlag,
} from "./agent-selection.ts";
import { runWorkflow } from "./workflow.ts";

export interface RunArgs {
  task: string;
  repo: string;
  worktree?: string;
  template: "single-step" | "researcher-implementer-tester";
  allType?: AgentType;
  researcherType?: AgentType;
  implementerType?: AgentType;
  testerType?: AgentType;
  timeoutMinutes: number;
  maxRetries: number;
  autoApprove: boolean;
}

function printRunUsage(): never {
  console.log("Usage: hydra run [options]");
  console.log("");
  console.log("Options:");
  console.log("  --task <desc>            Task description (required)");
  console.log("  --repo <path>            Path to the git repository (required)");
  console.log("  --worktree <path>        Use an existing worktree");
  console.log("  --template <name>        Workflow template: researcher-implementer-tester | single-step");
  console.log("  --all-type <type>        Use one agent type for researcher/implementer/tester");
  console.log("  --researcher-type <type> Researcher agent type");
  console.log("  --implementer-type <type> Implementer agent type");
  console.log("  --tester-type <type>     Tester agent type");
  console.log(`  --type <type>            Alias for --implementer-type (fallback default: ${DEFAULT_AGENT_TYPE})`);
  console.log("  --timeout-minutes <num>  Per-assignment timeout in minutes (default: 30)");
  console.log("  --max-retries <num>      Automatic retry limit (default: 1)");
  console.log("  --no-auto-approve        Disable auto-approve (sub-agents auto-approve by default)");
  console.log("");
  console.log("Mode guide:");
  console.log("  hydra run                          inherit the current terminal type when available");
  console.log("  hydra run --all-type codex         force all workflow roles onto codex");
  console.log("  hydra run --researcher-type claude --implementer-type codex --tester-type claude");
  console.log("                                     mix providers explicitly by role (researcher / implementer / tester)");
  console.log("  hydra run --template single-step   one implementer with file gates");
  console.log("  hydra spawn                       one direct isolated worker");
  process.exit(0);
}

export function parseRunArgs(args: string[]): RunArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printRunUsage();
  }

  const result: Partial<RunArgs> = {
    template: "researcher-implementer-tester",
    timeoutMinutes: 30,
    maxRetries: 1,
    autoApprove: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--task" && i + 1 < args.length) {
      result.task = args[++i];
    } else if (arg === "--repo" && i + 1 < args.length) {
      result.repo = args[++i];
    } else if (arg === "--worktree" && i + 1 < args.length) {
      result.worktree = args[++i];
    } else if (arg === "--template" && i + 1 < args.length) {
      result.template = args[++i] as RunArgs["template"];
    } else if (arg === "--all-type" && i + 1 < args.length) {
      result.allType = parseAgentTypeFlag("--all-type", args[++i]);
    } else if (arg === "--researcher-type" && i + 1 < args.length) {
      result.researcherType = parseAgentTypeFlag("--researcher-type", args[++i]);
    } else if ((arg === "--implementer-type" || arg === "--type") && i + 1 < args.length) {
      result.implementerType = parseAgentTypeFlag(arg, args[++i]);
    } else if (arg === "--tester-type" && i + 1 < args.length) {
      result.testerType = parseAgentTypeFlag("--tester-type", args[++i]);
    } else if (arg === "--timeout-minutes" && i + 1 < args.length) {
      result.timeoutMinutes = Number.parseInt(args[++i], 10);
    } else if (arg === "--max-retries" && i + 1 < args.length) {
      result.maxRetries = Number.parseInt(args[++i], 10);
    } else if (arg === "--auto-approve") {
      result.autoApprove = true;
    } else if (arg === "--no-auto-approve") {
      result.autoApprove = false;
    }
  }

  if (!result.task) throw new Error("Missing required flag: --task");
  if (!result.repo) throw new Error("Missing required flag: --repo");
  if (!Number.isFinite(result.timeoutMinutes) || (result.timeoutMinutes ?? 0) <= 0) {
    throw new Error("Expected --timeout-minutes to be a positive integer");
  }
  if (!Number.isFinite(result.maxRetries) || (result.maxRetries ?? 0) < 0) {
    throw new Error("Expected --max-retries to be a non-negative integer");
  }

  return result as RunArgs;
}

export async function run(args: string[]): Promise<void> {
  const parsed = parseRunArgs(args);
  const resolvedTypes = resolveWorkflowAgentTypes(parsed, process.env);
  const result = await runWorkflow({
    task: parsed.task,
    repoPath: path.resolve(parsed.repo),
    worktreePath: parsed.worktree ? path.resolve(parsed.worktree) : undefined,
    template: parsed.template,
    researcherType: resolvedTypes.researcherType,
    implementerType: resolvedTypes.implementerType,
    testerType: resolvedTypes.testerType,
    timeoutMinutes: parsed.timeoutMinutes,
    maxRetries: parsed.maxRetries,
    autoApprove: parsed.autoApprove,
  });
  console.log(JSON.stringify(result, null, 2));
}
