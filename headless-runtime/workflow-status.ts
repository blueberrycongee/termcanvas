import path from "node:path";
import {
  listWorkflows,
  type WorkflowRecord,
  type WorkflowStatus,
} from "../hydra/src/workflow-store.ts";

const ACTIVE_WORKFLOW_STATUSES = new Set<WorkflowStatus>([
  "pending",
  "running",
  "waiting_for_approval",
]);

export interface ActiveWorkflowSummary {
  id: string;
  status: WorkflowStatus;
  task: string;
  repo_path: string;
  worktree_path: string;
  current_handoff_id: string;
  updated_at: string;
}

function summarizeWorkflow(workflow: WorkflowRecord): ActiveWorkflowSummary {
  return {
    id: workflow.id,
    status: workflow.status,
    task: workflow.task,
    repo_path: workflow.repo_path,
    worktree_path: workflow.worktree_path,
    current_handoff_id: workflow.current_handoff_id,
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
