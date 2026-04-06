import path from "node:path";
import { requestWorkflowChallenge } from "./workflow.ts";

export interface ChallengeArgs {
  repo: string;
  workflow: string;
}

function printChallengeUsage(): never {
  console.log("Usage: hydra challenge --repo <path> --workflow <id>");
  console.log("");
  console.log("Request an explicit challenge at the current workflow boundary.");
  process.exit(0);
}

export function parseChallengeArgs(args: string[]): ChallengeArgs {
  if (args.includes("--help") || args.includes("-h")) {
    printChallengeUsage();
  }

  const result: Partial<ChallengeArgs> = {};
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
  return result as ChallengeArgs;
}

export async function challenge(args: string[]): Promise<void> {
  const parsed = parseChallengeArgs(args);
  const result = await requestWorkflowChallenge({
    repoPath: path.resolve(parsed.repo),
    workflowId: parsed.workflow,
  });
  console.log(JSON.stringify(result, null, 2));
}
