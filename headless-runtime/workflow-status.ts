import path from "node:path";
import {
  listWorkflows,
  type WorkflowRecord,
  type WorkflowStatus,
} from "../hydra/src/workflow-store.ts";

const ACTIVE_WORKFLOW_STATUSES = new Set<WorkflowStatus>([
  "active",
]);

export interface ActiveWorkflowSummary {
  id: string;
  status: WorkflowStatus;
  intent: string;
  repo_path: string;
  worktree_path: string;
  active_node_ids: string[];
  updated_at: string;
}

function summarizeWorkflow(workflow: WorkflowRecord): ActiveWorkflowSummary {
  const activeNodeIds = Object.entries(workflow.node_statuses ?? {})
    .filter(([, s]) => s === "dispatched" || s === "eligible")
    .map(([id]) => id);
  return {
    id: workflow.id,
    status: workflow.status,
    intent: workflow.intent,
    repo_path: workflow.repo_path,
    worktree_path: workflow.worktree_path,
    active_node_ids: activeNodeIds,
    updated_at: workflow.updated_at,
  };
}

export function listActiveWorkflowSummaries(input: {
  workspaceDir?: string;
  projectPaths?: string[];
}): ActiveWorkflowSummary[] {
  const repoRoots = new Set<string>();
  if (input.workspaceDir) {
    repoRoots.add(path.resolve(input.workspaceDir));
  }
  for (const projectPath of input.projectPaths ?? []) {
    repoRoots.add(path.resolve(projectPath));
  }

  const seen = new Set<string>();
  const workflows: ActiveWorkflowSummary[] = [];

  for (const repoPath of repoRoots) {
    for (const workflow of listWorkflows(repoPath)) {
      if (!ACTIVE_WORKFLOW_STATUSES.has(workflow.status)) {
        continue;
      }

      const key = `${path.resolve(workflow.repo_path)}:${workflow.id}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      workflows.push(summarizeWorkflow(workflow));
    }
  }

  workflows.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  return workflows;
}
