import { z } from "zod";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";
import { getClient } from "./client.ts";

const UNAVAILABLE_ACTIONS = new Set(["spawn", "approve", "revise"]);

const inputSchema = z.object({
  action: z.enum([
    "run", "spawn", "list", "status", "tick", "watch", "retry", "cleanup", "approve", "revise",
  ]).describe(
    "Workflow action. spawn/approve/revise are not available via HTTP API.",
  ),
  repo: z.string().optional().describe("Repository path (required for most actions)"),
  workflowId: z.string().optional().describe("Workflow ID (required for status, tick, watch, retry, cleanup)"),
  task: z.string().optional().describe("Task description (required for run)"),
  worktree: z.string().optional().describe("Worktree path (for run)"),
  template: z.string().optional().describe("Workflow template (for run, e.g. single-step)"),
  allType: z.string().optional().describe("Provider type for all roles (for run)"),
  plannerType: z.string().optional().describe("Provider type for planner (for run)"),
  implementerType: z.string().optional().describe("Provider type for implementer (for run)"),
  evaluatorType: z.string().optional().describe("Provider type for evaluator (for run)"),
  timeoutMinutes: z.number().optional().describe("Timeout in minutes (for run)"),
  maxRetries: z.number().optional().describe("Max retries (for run)"),
  autoApprove: z.boolean().optional().describe("Auto-approve mode (for run, default true)"),
  approvePlan: z.boolean().optional().describe("Auto-approve plan (for run)"),
  force: z.boolean().optional().describe("Force cleanup (for cleanup)"),
  intervalMs: z.number().optional().describe("Poll interval in ms (for watch, default 30000)"),
  timeoutMs: z.number().optional().describe("Total timeout in ms (for watch, default 3600000)"),
});

export const hydraWorkflowTool: Tool<typeof inputSchema.shape> = {
  name: "HydraWorkflow",
  description: "Manage Hydra workflows: run, list, status, tick, watch, retry, cleanup. spawn/approve/revise are not available via HTTP — use the Hydra CLI.",
  inputSchema,
  isReadOnly: false,

  async call(input: z.infer<typeof inputSchema>, signal?: AbortSignal): Promise<ToolResult> {
    const { action } = input;

    if (UNAVAILABLE_ACTIONS.has(action)) {
      return { content: `Action '${action}' is not available via HTTP API. Use the Hydra CLI directly.`, is_error: true };
    }

    const client = getClient();

    if (action === "run") {
      if (!input.task) return { content: "task is required for run", is_error: true };
      if (!input.repo) return { content: "repo is required for run", is_error: true };
      const body: Record<string, unknown> = {
        task: input.task,
        repo: input.repo,
        autoApprove: input.autoApprove ?? true,
      };
      if (input.worktree) body.worktree = input.worktree;
      if (input.template) body.template = input.template;
      if (input.allType) body.allType = input.allType;
      if (input.plannerType) body.plannerType = input.plannerType;
      if (input.implementerType) body.implementerType = input.implementerType;
      if (input.evaluatorType) body.evaluatorType = input.evaluatorType;
      if (input.timeoutMinutes) body.timeoutMinutes = input.timeoutMinutes;
      if (input.maxRetries !== undefined) body.maxRetries = input.maxRetries;
      if (input.approvePlan) body.approvePlan = input.approvePlan;
      const result = await client.request("POST", "/workflow/run", body);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "list") {
      if (!input.repo) return { content: "repo is required for list", is_error: true };
      const result = await client.request("GET", `/workflow/list?repo=${encodeURIComponent(input.repo)}`);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (!input.workflowId) return { content: "workflowId is required for " + action, is_error: true };
    if (!input.repo) return { content: "repo is required for " + action, is_error: true };
    const wfId = encodeURIComponent(input.workflowId);
    const repo = input.repo;

    if (action === "status") {
      const result = await client.request("GET", `/workflow/${wfId}?repo=${encodeURIComponent(repo)}`);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "tick") {
      const result = await client.request("POST", `/workflow/${wfId}/tick`, { repo });
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "retry") {
      const result = await client.request("POST", `/workflow/${wfId}/retry`, { repo });
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "cleanup") {
      const params = new URLSearchParams({ repo });
      if (input.force) params.set("force", "true");
      const result = await client.request("DELETE", `/workflow/${wfId}?${params.toString()}`);
      return { content: JSON.stringify(result, null, 2) };
    }

    const intervalMs = input.intervalMs ?? 30_000;
    const timeoutMs = input.timeoutMs ?? 3_600_000;
    const startedAt = Date.now();

    let result = await client.request("POST", `/workflow/${wfId}/tick`, { repo }) as Record<string, unknown>;
    const workflow = result.workflow as Record<string, unknown> | undefined;
    let status = workflow?.status as string | undefined;

    while (
      status !== "completed" &&
      status !== "failed" &&
      status !== "waiting_for_approval" &&
      Date.now() - startedAt < timeoutMs
    ) {
      if (signal?.aborted) return { content: "Watch aborted", is_error: true };
      await new Promise((r) => setTimeout(r, intervalMs));
      result = await client.request("POST", `/workflow/${wfId}/tick`, { repo }) as Record<string, unknown>;
      const wf = result.workflow as Record<string, unknown> | undefined;
      status = wf?.status as string | undefined;
    }

    return { content: JSON.stringify(result, null, 2) };
  },
};
