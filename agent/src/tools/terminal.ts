import { z } from "zod";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";
import { getClient } from "./client.ts";

const inputSchema = z.object({
  action: z.enum(["create", "list", "status", "output", "destroy", "set-title"]).describe(
    "Terminal action: create, list, status, output, destroy, or set-title",
  ),
  terminalId: z.string().optional().describe("Terminal ID (required for status, output, destroy, set-title)"),
  worktree: z.string().optional().describe("Worktree path (required for create, optional filter for list)"),
  type: z.string().optional().describe("Terminal type: shell, claude, codex (default: shell, for create)"),
  prompt: z.string().optional().describe("Initial prompt to send (for create)"),
  autoApprove: z.boolean().optional().describe("Enable auto-approve mode (for create)"),
  parentTerminalId: z.string().optional().describe("Parent terminal ID (for create)"),
  workflowId: z.string().optional().describe("Associated workflow ID (for create)"),
  handoffId: z.string().optional().describe("Associated handoff ID (for create)"),
  repoPath: z.string().optional().describe("Repository path (for create)"),
  lines: z.number().optional().describe("Number of output lines to return (for output, default 50)"),
  customTitle: z.string().optional().describe("Custom title text (required for set-title)"),
});

export const terminalTool: Tool<typeof inputSchema.shape> = {
  name: "TerminalManage",
  description: "Manage TermCanvas terminals: create, list, get status/output, destroy, or set title.",
  inputSchema,
  isReadOnly: false,

  async call(input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    const client = getClient();
    const { action } = input;

    if (action === "create") {
      if (!input.worktree) return { content: "worktree is required for create", is_error: true };
      const body: Record<string, unknown> = {
        worktree: input.worktree,
        type: input.type ?? "shell",
      };
      if (input.prompt) body.prompt = input.prompt;
      if (input.autoApprove) body.autoApprove = true;
      if (input.parentTerminalId) body.parentTerminalId = input.parentTerminalId;
      if (input.workflowId) body.workflowId = input.workflowId;
      if (input.handoffId) body.handoffId = input.handoffId;
      if (input.repoPath) body.repoPath = input.repoPath;
      const result = await client.request("POST", "/terminal/create", body);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "list") {
      const query = input.worktree ? `?worktree=${encodeURIComponent(input.worktree)}` : "";
      const result = await client.request("GET", `/terminal/list${query}`);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "status") {
      if (!input.terminalId) return { content: "terminalId is required for status", is_error: true };
      const result = await client.request("GET", `/terminal/${encodeURIComponent(input.terminalId)}/status`);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "output") {
      if (!input.terminalId) return { content: "terminalId is required for output", is_error: true };
      const lines = input.lines ?? 50;
      const result = await client.request(
        "GET",
        `/terminal/${encodeURIComponent(input.terminalId)}/output?lines=${lines}`,
      );
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "destroy") {
      if (!input.terminalId) return { content: "terminalId is required for destroy", is_error: true };
      const result = await client.request("DELETE", `/terminal/${encodeURIComponent(input.terminalId)}`);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (!input.terminalId) return { content: "terminalId is required for set-title", is_error: true };
    if (!input.customTitle) return { content: "customTitle is required for set-title", is_error: true };
    const result = await client.request(
      "PUT",
      `/terminal/${encodeURIComponent(input.terminalId)}/custom-title`,
      { customTitle: input.customTitle },
    );
    return { content: JSON.stringify(result, null, 2) };
  },
};
