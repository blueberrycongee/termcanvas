import { z } from "zod";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";

const inputSchema = z.object({
  action: z.enum(["list", "cleanup"]).describe(
    "Agent action. Both list and cleanup are not available via HTTP API — use the Hydra CLI directly.",
  ),
  agentId: z.string().optional().describe("Agent ID (for cleanup)"),
  repo: z.string().optional().describe("Repository path (for list)"),
});

export const hydraAgentTool: Tool<typeof inputSchema.shape> = {
  name: "HydraAgent",
  description: "Manage Hydra direct agents. Note: list and cleanup are only available via the Hydra CLI, not HTTP API.",
  inputSchema,
  isReadOnly: true,

  async call(input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    return {
      content: `Action '${input.action}' is not available via HTTP API. Use the Hydra CLI: hydra ${input.action}${input.action === "cleanup" && input.agentId ? " " + input.agentId : input.action === "list" ? " --repo ." : ""}`,
      is_error: true,
    };
  },
};
