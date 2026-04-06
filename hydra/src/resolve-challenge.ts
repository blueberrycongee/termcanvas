import path from "node:path";
import { resolveWorkflowChallenge } from "./workflow.ts";

export interface ResolveChallengeArgs {
  repo: string;
  workflow: string;
  decision: "continue" | "send_back";
  to?: "researcher" | "implementer" | "tester";
}

function printResolveChallengeUsage(): never {
  console.log("Usage: hydra resolve-challenge --repo <path> --workflow <id> --decision <continue|send_back> [--to <researcher|implementer|tester>]");
  console.log("");
  console.log("Resolve a completed explicit challenge by continuing or sending work back.");
  process.exit(0);
}

export function parseResolveChallengeArgs(args: string[]): ResolveChallengeArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printResolveChallengeUsage();
  }

  const result: Partial<ResolveChallengeArgs> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--repo" && i + 1 < args.length) {
      result.repo = args[++i];
    } else if (arg === "--workflow" && i + 1 < args.length) {
      result.workflow = args[++i];
    } else if (arg === "--decision" && i + 1 < args.length) {
      const decision = args[++i];
      if (decision !== "continue" && decision !== "send_back") {
        throw new Error(`Invalid --decision value: ${decision}`);
      }
      result.decision = decision;
    } else if (arg === "--to" && i + 1 < args.length) {
      const target = args[++i];
      if (target !== "researcher" && target !== "implementer" && target !== "tester") {
        throw new Error(`Invalid --to value: ${target}`);
      }
      result.to = target;
    }
  }

  if (!result.repo) throw new Error("Missing required flag: --repo");
  if (!result.workflow) throw new Error("Missing required flag: --workflow");
  if (!result.decision) throw new Error("Missing required flag: --decision");
  if (result.decision === "send_back" && !result.to) {
    throw new Error("Missing required flag: --to");
  }
  return result as ResolveChallengeArgs;
}

export async function resolveChallenge(args: string[]): Promise<void> {
  const parsed = parseResolveChallengeArgs(args);
  const result = await resolveWorkflowChallenge({
    repoPath: path.resolve(parsed.repo),
    workflowId: parsed.workflow,
    decision: parsed.decision,
    to: parsed.to,
  });
  console.log(JSON.stringify(result, null, 2));
}
