import { z } from "zod";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";
import { getClient } from "./client.ts";

const inputSchema = z.object({
  worktreePath: z.string().describe("Absolute path to the worktree"),
  summary: z.boolean().optional().describe("If true, return file stats only instead of full diff"),
});

export const diffTool: Tool<typeof inputSchema.shape> = {
  name: "Diff",
  description: "Get git diff for a worktree. Returns full diff or file-level summary with additions/deletions.",
  inputSchema,
  isReadOnly: true,

  async call(input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    const query = input.summary ? "?summary" : "";
    const result = await getClient().request(
      "GET",
      `/diff/${encodeURIComponent(input.worktreePath)}${query}`,
    );
    return { content: JSON.stringify(result, null, 2) };
  },
};
