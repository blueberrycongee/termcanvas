import path from "node:path";
import { retryWorkflow } from "./workflow.ts";

export interface RetryArgs {
  repo: string;
  workflow: string;
}

function printRetryUsage(): never {
  console.log("Usage: hydra retry --repo <path> --workflow <id>");
  process.exit(0);
}

export function parseRetryArgs(args: string[]): RetryArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printRetryUsage();
  }

  const result: Partial<RetryArgs> = {};
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
  return result as RetryArgs;
}

export async function retry(args: string[]): Promise<void> {
  const parsed = parseRetryArgs(args);
  const result = await retryWorkflow({
    repoPath: path.resolve(parsed.repo),
    workflowId: parsed.workflow,
  });
  console.log(JSON.stringify(result, null, 2));
}
