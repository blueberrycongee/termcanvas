import { z } from "zod";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";
import { getClient } from "./client.ts";

const inputSchema = z.object({
  action: z.enum(["list", "create", "remove"]).describe(
    "Worktree action: list worktrees for a repo, create a new worktree, or remove one",
  ),
  repo: z.string().describe("Repository path"),
  branch: z.string().optional().describe("Branch name (required for create)"),
  path: z.string().optional().describe("Worktree filesystem path (required for remove)"),
  baseBranch: z.string().optional().describe("Base branch to create from (optional for create)"),
  force: z.boolean().optional().describe("Force removal even if dirty (optional for remove)"),
});

export const worktreeTool: Tool<typeof inputSchema.shape> = {
  name: "WorktreeManage",
  description: "Manage git worktrees: list, create, or remove worktrees for a repository.",
  inputSchema,
  isReadOnly: false,

  async call(input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    const client = getClient();
    const { action, repo } = input;

    if (action === "list") {
      const result = await client.request("GET", `/worktree/list?repo=${encodeURIComponent(repo)}`);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (action === "create") {
      if (!input.branch) return { content: "branch is required for create", is_error: true };
      const body: Record<string, unknown> = { repo, branch: input.branch };
      if (input.path) body.path = input.path;
      if (input.baseBranch) body.baseBranch = input.baseBranch;
      const result = await client.request("POST", "/worktree/create", body);
      return { content: JSON.stringify(result, null, 2) };
    }

    if (!input.path) return { content: "path is required for remove", is_error: true };
    const params = new URLSearchParams({ repo, path: input.path });
    if (input.force) params.set("force", "true");
    const result = await client.request("DELETE", `/worktree?${params.toString()}`);
    return { content: JSON.stringify(result, null, 2) };
  },
};
