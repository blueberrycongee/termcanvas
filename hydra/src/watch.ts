import path from "node:path";
import { enrichWorkflowStatusView } from "./telemetry.ts";
import { watchWorkflow } from "./workflow.ts";

export interface WatchArgs {
  repo: string;
  workflow: string;
  intervalMs: number;
  timeoutMs?: number;
}

function printWatchUsage(): never {
  console.log("Usage: hydra watch --repo <path> --workflow <id> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --interval-ms <num>  Polling interval in milliseconds (default: 1000)");
  console.log("  --timeout-ms <num>   Stop watching after this many milliseconds");
  process.exit(0);
}

export function parseWatchArgs(args: string[]): WatchArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printWatchUsage();
  }

  const result: Partial<WatchArgs> = {
    intervalMs: 1000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--repo" && i + 1 < args.length) {
      result.repo = args[++i];
    } else if (arg === "--workflow" && i + 1 < args.length) {
      result.workflow = args[++i];
    } else if (arg === "--interval-ms" && i + 1 < args.length) {
      result.intervalMs = Number.parseInt(args[++i], 10);
    } else if (arg === "--timeout-ms" && i + 1 < args.length) {
      result.timeoutMs = Number.parseInt(args[++i], 10);
    }
  }

  if (!result.repo) throw new Error("Missing required flag: --repo");
  if (!result.workflow) throw new Error("Missing required flag: --workflow");
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
  const result = enrichWorkflowStatusView(await watchWorkflow({
    repoPath: path.resolve(parsed.repo),
    workflowId: parsed.workflow,
    intervalMs: parsed.intervalMs,
    timeoutMs: parsed.timeoutMs,
  }));
  console.log(JSON.stringify(result, null, 2));
}
