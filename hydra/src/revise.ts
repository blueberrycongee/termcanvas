import path from "node:path";
import { reviseWorkflow } from "./workflow.ts";

export interface ReviseArgs {
  repo: string;
  workflow: string;
  feedback: string;
}

function printReviseUsage(): never {
  console.log("Usage: hydra revise --repo <path> --workflow <id> --feedback <text>");
  console.log("");
  console.log("Revise the planner's plan with feedback and re-run the planner.");
  process.exit(0);
}

export function parseReviseArgs(args: string[]): ReviseArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printReviseUsage();
  }

  const result: Partial<ReviseArgs> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--repo" && i + 1 < args.length) {
      result.repo = args[++i];
    } else if (arg === "--workflow" && i + 1 < args.length) {
      result.workflow = args[++i];
    } else if (arg === "--feedback" && i + 1 < args.length) {
      result.feedback = args[++i];
    }
  }

  if (!result.repo) throw new Error("Missing required flag: --repo");
  if (!result.workflow) throw new Error("Missing required flag: --workflow");
  if (!result.feedback) throw new Error("Missing required flag: --feedback");
  return result as ReviseArgs;
}

export async function revise(args: string[]): Promise<void> {
  const parsed = parseReviseArgs(args);
  const result = await reviseWorkflow({
    repoPath: path.resolve(parsed.repo),
    workflowId: parsed.workflow,
    feedback: parsed.feedback,
  });
  console.log(JSON.stringify(result, null, 2));
}
