import path from "node:path";
import { approveWorkflow } from "./workflow.ts";

export interface ApproveArgs {
  repo: string;
  workflow: string;
}

function printApproveUsage(): never {
  console.log("Usage: hydra approve --repo <path> --workflow <id>");
  console.log("");
  console.log("Approve the planner's plan and continue to implementation.");
  process.exit(0);
}

export function parseApproveArgs(args: string[]): ApproveArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printApproveUsage();
  }

  const result: Partial<ApproveArgs> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--repo" && i + 1 < args.length) {
      result.repo = args[++i];
    } else if (arg === "--workflow" && i + 1 < args.length) {
      result.workflow = args[++i];
    }
  }

  if (!result.repo) throw new Error("Missing required flag: --repo");
  if (!result.workflow) throw new Error("Missing required flag: --workflow");
  return result as ApproveArgs;
}

export async function approve(args: string[]): Promise<void> {
  const parsed = parseApproveArgs(args);
  const result = await approveWorkflow({
    repoPath: path.resolve(parsed.repo),
    workflowId: parsed.workflow,
  });
  console.log(JSON.stringify(result, null, 2));
}
