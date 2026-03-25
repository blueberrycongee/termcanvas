import path from "node:path";
import { runWorkflow } from "./workflow.ts";

export interface RunArgs {
  task: string;
  repo: string;
  worktree?: string;
  template: "single-step" | "planner-implementer-evaluator";
  type: "claude" | "codex" | "kimi" | "gemini";
  evaluatorType: "claude" | "codex" | "kimi" | "gemini";
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
  console.log("  --template <name>       Workflow template: single-step | planner-implementer-evaluator");
  console.log("  --type <type>            Agent type: claude, codex, kimi, gemini (default: codex)");
  console.log("  --evaluator-type <type>  Evaluator agent type (default: claude)");
  console.log("  --timeout-minutes <num>  Per-handoff timeout in minutes (default: 30)");
  console.log("  --max-retries <num>      Automatic retry limit (default: 1)");
  console.log("  --auto-approve           Run sub-agent in auto-approve mode");
  process.exit(0);
}

export function parseRunArgs(args: string[]): RunArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printRunUsage();
  }

  const result: Partial<RunArgs> = {
    template: "single-step",
    type: "codex",
    evaluatorType: "claude",
    timeoutMinutes: 30,
    maxRetries: 1,
    autoApprove: false,
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
    } else if (arg === "--type" && i + 1 < args.length) {
      result.type = args[++i] as RunArgs["type"];
    } else if (arg === "--evaluator-type" && i + 1 < args.length) {
      result.evaluatorType = args[++i] as RunArgs["evaluatorType"];
    } else if (arg === "--timeout-minutes" && i + 1 < args.length) {
      result.timeoutMinutes = Number.parseInt(args[++i], 10);
    } else if (arg === "--max-retries" && i + 1 < args.length) {
      result.maxRetries = Number.parseInt(args[++i], 10);
    } else if (arg === "--auto-approve") {
      result.autoApprove = true;
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
  const result = await runWorkflow({
    task: parsed.task,
    repoPath: path.resolve(parsed.repo),
    worktreePath: parsed.worktree ? path.resolve(parsed.worktree) : undefined,
    template: parsed.template,
    agentType: parsed.type,
    evaluatorType: parsed.evaluatorType,
    timeoutMinutes: parsed.timeoutMinutes,
    maxRetries: parsed.maxRetries,
    autoApprove: parsed.autoApprove,
  });
  console.log(JSON.stringify(result, null, 2));
}
