import { z } from "zod";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";
import { getClient } from "./client.ts";

const inputSchema = z.object({
  action: z.enum(["add", "list", "remove", "rescan"]).describe(
    "Project action: add a project path, list all projects, remove by ID, or rescan worktrees",
  ),
  path: z.string().optional().describe("Filesystem path to the project (required for add)"),
  projectId: z.string().optional().describe("Project ID (required for remove and rescan)"),
});

export const projectTool: Tool<typeof inputSchema.shape> = {
  name: "ProjectManage",
  description: "Manage TermCanvas projects: add, list, remove, or rescan worktrees.",
  inputSchema,
  isReadOnly: false,

  async call(input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    const client = getClient();
    const { action } = input;

    if (action === "add") {
      if (!input.path) return { content: "path is required for add", is_error: true };
      const result = await client.request("POST", "/project/add", { path: input.path });
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "list") {
      const result = await client.request("GET", "/project/list");
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "remove") {
      if (!input.projectId) return { content: "projectId is required for remove", is_error: true };
      const result = await client.request("DELETE", `/project/${encodeURIComponent(input.projectId)}`);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (!input.projectId) return { content: "projectId is required for rescan", is_error: true };
    const result = await client.request("POST", `/project/${encodeURIComponent(input.projectId)}/rescan`);
    return { content: JSON.stringify(result, null, 2) };
  },
};
