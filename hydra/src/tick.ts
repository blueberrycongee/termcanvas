import path from "node:path";
import { tickWorkflow } from "./workflow.ts";

export interface TickArgs {
  repo: string;
  workflow: string;
}

function printTickUsage(): never {
  console.log("Usage: hydra tick --repo <path> --workflow <id>");
  process.exit(0);
}

export function parseTickArgs(args: string[]): TickArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printTickUsage();
  }

  const result: Partial<TickArgs> = {};
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
  return result as TickArgs;
}

export async function tick(args: string[]): Promise<void> {
  const parsed = parseTickArgs(args);
  const result = await tickWorkflow({
    repoPath: path.resolve(parsed.repo),
    workflowId: parsed.workflow,
  });
  console.log(JSON.stringify(result, null, 2));
}
