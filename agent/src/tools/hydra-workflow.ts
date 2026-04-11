import { z } from "zod";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";
import { getClient } from "./client.ts";

const inputSchema = z.object({
  action: z.enum([
    "init", "dispatch", "redispatch", "watch", "approve", "reset", "merge",
    "complete", "fail", "status", "list", "list-roles", "cleanup",
  ]).describe(
    "Workflow action.",
  ),
  repo: z.string().optional().describe("Repository path (required for most actions)"),
  workflowId: z.string().optional().describe("Workflow ID (required for all except init and list)"),

  // init
  intent: z.string().optional().describe("Workflow or node intent (for init, dispatch)"),
  worktree: z.string().optional().describe("Worktree path (for init)"),
  agentType: z.string().optional().describe("Default agent type for the workflow (for init only). Dispatch derives agent_type from the role file."),
  model: z.string().optional().describe("Override the role's default model (for dispatch, e.g. opus)"),
  timeoutMinutes: z.number().optional().describe("Timeout in minutes (for init, dispatch)"),
  maxRetries: z.number().optional().describe("Max retries (for init, dispatch)"),
  autoApprove: z.boolean().optional().describe("Auto-approve mode (for init, default true)"),

  // dispatch
  nodeId: z.string().optional().describe("Node ID (for dispatch, approve, reset)"),
  role: z.string().optional().describe("Agent role (for dispatch)"),
  dependsOn: z.array(z.string()).optional().describe("Dependency node IDs (for dispatch)"),
  contextRefs: z.array(z.object({
    label: z.string(),
    path: z.string(),
  })).optional().describe("Context artifact refs (for dispatch)"),
  feedback: z.string().optional().describe("Feedback text (for reset, dispatch)"),
  worktreePath: z.string().optional().describe("Isolated worktree path (for dispatch)"),
  worktreeBranch: z.string().optional().describe("Branch name for isolated worktree (for dispatch)"),

  // merge
  nodeIds: z.array(z.string()).optional().describe("Node IDs to merge (for merge)"),

  // complete/fail
  summary: z.string().optional().describe("Completion summary (for complete)"),
  reason: z.string().optional().describe("Failure reason (for fail)"),

  // cleanup
  force: z.boolean().optional().describe("Force cleanup (for cleanup)"),
});

export const hydraWorkflowTool: Tool<typeof inputSchema.shape> = {
  name: "HydraWorkflow",
  description: "Manage Hydra workflows: init, dispatch, watch, approve, reset, merge, complete, fail, status, list, cleanup.",
  inputSchema,
  isReadOnly: false,

  async call(input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    const { action } = input;
    const client = getClient();

    if (action === "init") {
      if (!input.intent) return { content: "intent is required for init", is_error: true };
      if (!input.repo) return { content: "repo is required for init", is_error: true };
      const body: Record<string, unknown> = {
        intent: input.intent,
        repo: input.repo,
        autoApprove: input.autoApprove ?? true,
      };
      if (input.worktree) body.worktreePath = input.worktree;
      if (input.agentType) body.agentType = input.agentType;
      if (input.timeoutMinutes) body.timeoutMinutes = input.timeoutMinutes;
      if (input.maxRetries !== undefined) body.maxRetries = input.maxRetries;
      const result = await client.request("POST", "/workflow/init", body);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "list") {
      if (!input.repo) return { content: "repo is required for list", is_error: true };
      const result = await client.request("GET", `/workflow/list?repo=${encodeURIComponent(input.repo)}`);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "list-roles") {
      if (!input.repo) return { content: "repo is required for list-roles", is_error: true };
      const params = new URLSearchParams({ repo: input.repo });
      if (input.agentType) params.set("agentType", input.agentType);
      const result = await client.request("GET", `/workflow/list-roles?${params.toString()}`);
      return { content: JSON.stringify(result, null, 2) };
    }

    // All remaining actions require workflowId and repo
    if (!input.workflowId) return { content: "workflowId is required for " + action, is_error: true };
    if (!input.repo) return { content: "repo is required for " + action, is_error: true };
    const wfId = encodeURIComponent(input.workflowId);
    const repo = input.repo;

    if (action === "dispatch") {
      if (!input.nodeId) return { content: "nodeId is required for dispatch", is_error: true };
      if (!input.role) return { content: "role is required for dispatch", is_error: true };
      if (!input.intent) return { content: "intent is required for dispatch", is_error: true };
      const body: Record<string, unknown> = {
        repo, nodeId: input.nodeId, role: input.role, intent: input.intent,
      };
      if (input.dependsOn) body.dependsOn = input.dependsOn;
      if (input.model) body.model = input.model;
      if (input.contextRefs) body.contextRefs = input.contextRefs;
      if (input.feedback) body.feedback = input.feedback;
      if (input.worktreePath) body.worktreePath = input.worktreePath;
      if (input.worktreeBranch) body.worktreeBranch = input.worktreeBranch;
      if (input.timeoutMinutes) body.timeoutMinutes = input.timeoutMinutes;
      if (input.maxRetries !== undefined) body.maxRetries = input.maxRetries;
      const result = await client.request("POST", `/workflow/${wfId}/dispatch`, body);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "redispatch") {
      if (!input.nodeId) return { content: "nodeId is required for redispatch", is_error: true };
      const nodeId = encodeURIComponent(input.nodeId);
      const body: Record<string, unknown> = { repo };
      if (input.intent) body.intent = input.intent;
      const result = await client.request("POST", `/workflow/${wfId}/node/${nodeId}/redispatch`, body);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "watch") {
      const result = await client.request("POST", `/workflow/${wfId}/watch-decision`, { repo });
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "approve") {
      if (!input.nodeId) return { content: "nodeId is required for approve", is_error: true };
      const nodeId = encodeURIComponent(input.nodeId);
      const result = await client.request("POST", `/workflow/${wfId}/node/${nodeId}/approve`, { repo });
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "reset") {
      if (!input.nodeId) return { content: "nodeId is required for reset", is_error: true };
      const nodeId = encodeURIComponent(input.nodeId);
      const body: Record<string, unknown> = { repo };
      if (input.feedback) body.feedback = input.feedback;
      const result = await client.request("POST", `/workflow/${wfId}/node/${nodeId}/reset`, body);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "merge") {
      if (!input.nodeIds) return { content: "nodeIds is required for merge", is_error: true };
      const result = await client.request("POST", `/workflow/${wfId}/merge`, { repo, nodeIds: input.nodeIds });
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "complete") {
      const body: Record<string, unknown> = { repo };
      if (input.summary) body.summary = input.summary;
      const result = await client.request("POST", `/workflow/${wfId}/complete`, body);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "fail") {
      if (!input.reason) return { content: "reason is required for fail", is_error: true };
      const result = await client.request("POST", `/workflow/${wfId}/fail`, { repo, reason: input.reason });
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "status") {
      const result = await client.request("GET", `/workflow/${wfId}?repo=${encodeURIComponent(repo)}`);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "cleanup") {
      const params = new URLSearchParams({ repo });
      if (input.force) params.set("force", "true");
      const result = await client.request("DELETE", `/workflow/${wfId}?${params.toString()}`);
      return { content: JSON.stringify(result, null, 2) };
    }

    return { content: `Unknown action: ${action}`, is_error: true };
  },
};
