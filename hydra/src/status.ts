import path from "node:path";
import { getWorkflowStatus } from "./workflow.ts";

export interface StatusArgs {
  repo: string;
  workflow: string;
}

function printStatusUsage(): never {
  console.log("Usage: hydra status --repo <path> --workflow <id>");
  process.exit(0);
}

export function parseStatusArgs(args: string[]): StatusArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printStatusUsage();
  }

  const result: Partial<StatusArgs> = {};
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
  return result as StatusArgs;
}

export async function status(args: string[]): Promise<void> {
  const parsed = parseStatusArgs(args);
  const result = getWorkflowStatus({
    repoPath: path.resolve(parsed.repo),
    workflowId: parsed.workflow,
  });
  console.log(JSON.stringify(result, null, 2));
}
