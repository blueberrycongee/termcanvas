import { z } from "zod";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";
import { getClient } from "./client.ts";

const inputSchema = z.object({
  action: z.enum(["get-terminal", "get-workflow", "list-events"]).describe(
    "Telemetry action: get-terminal for terminal snapshot, get-workflow for workflow snapshot, list-events for terminal event history",
  ),
  terminalId: z.string().optional().describe("Terminal ID (required for get-terminal and list-events)"),
  workflowId: z.string().optional().describe("Workflow ID (required for get-workflow)"),
  repo: z.string().optional().describe("Repository path (used with get-workflow)"),
  limit: z.number().optional().describe("Max events to return (list-events, default 50)"),
  cursor: z.string().optional().describe("Pagination cursor for list-events"),
});

export const telemetryTool: Tool<typeof inputSchema.shape> = {
  name: "Telemetry",
  description: "Get terminal or workflow telemetry snapshots and event history from TermCanvas.",
  inputSchema,
  isReadOnly: true,

  async call(input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    const client = getClient();
    const { action } = input;

    if (action === "get-terminal") {
      if (!input.terminalId) return { content: "terminalId is required for get-terminal", is_error: true };
      const result = await client.request("GET", `/telemetry/terminal/${encodeURIComponent(input.terminalId)}`);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "get-workflow") {
      if (!input.workflowId) return { content: "workflowId is required for get-workflow", is_error: true };
      const repo = input.repo ?? process.cwd();
      const result = await client.request(
        "GET",
        `/telemetry/workflow/${encodeURIComponent(input.workflowId)}?repo=${encodeURIComponent(repo)}`,
      );
      return { content: JSON.stringify(result, null, 2) };
    }

    // list-events
    if (!input.terminalId) return { content: "terminalId is required for list-events", is_error: true };
    const params = new URLSearchParams({ limit: String(input.limit ?? 50) });
    if (input.cursor) params.set("cursor", input.cursor);
    const result = await client.request(
      "GET",
      `/telemetry/terminal/${encodeURIComponent(input.terminalId)}/events?${params.toString()}`,
    );
    return { content: JSON.stringify(result, null, 2) };
  },
};
