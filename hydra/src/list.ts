import path from "node:path";
import { listAgents } from "./store.ts";
import { listWorkbenches } from "./workflow-store.ts";

export async function list(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: hydra list [options]");
    console.log("");
    console.log("Options:");
    console.log("  --repo <path>  Filter agents by repository path");
    console.log("  --workbenches  List workbench records instead of agents");
    process.exit(0);
  }

  const repoIdx = args.indexOf("--repo");
  const repo = repoIdx >= 0 ? path.resolve(args[repoIdx + 1]) : undefined;
  const workflowsMode = args.includes("--workbenches");

  if (workflowsMode) {
    const workflowRepo = repo ?? process.cwd();
    const workflows = listWorkbenches(workflowRepo);
    if (workflows.length === 0) {
      console.log("No workbenches.");
      return;
    }
    for (const workflow of workflows) {
      const failure = workflow.failure?.code ?? "-";
      console.log(
        `${workflow.id}  ${workflow.status}  ${failure}`,
      );
    }
    return;
  }

  const agents = listAgents(repo);

  if (agents.length === 0) {
    console.log("No agents.");
    return;
  }

  for (const a of agents) {
    const branch = a.branch ?? "(existing worktree)";
    console.log(`${a.id}  ${a.type}  ${branch}  ${a.terminalId}  ${a.task.slice(0, 60)}`);
  }
}
