import { z } from "zod";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";

const inputSchema = z.object({
  action: z.enum(["list", "watch", "cleanup"]).describe(
    "Agent action. All actions are CLI-only — use the Hydra CLI directly.",
  ),
  agentId: z.string().optional().describe("Agent ID (for watch, cleanup)"),
  repo: z.string().optional().describe("Repository path (for list)"),
});

export const hydraAgentTool: Tool<typeof inputSchema.shape> = {
  name: "HydraAgent",
  description: "Manage Hydra direct agents (spawned workers). Actions: list, watch, cleanup. All are CLI-only — use the Hydra CLI.",
  inputSchema,
  isReadOnly: true,

  async call(input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    let cliHint: string;
    if (input.action === "watch" && input.agentId) {
      cliHint = `hydra watch --agent ${input.agentId}`;
    } else if (input.action === "cleanup" && input.agentId) {
      cliHint = `hydra cleanup ${input.agentId}`;
    } else if (input.action === "list") {
      cliHint = "hydra list --repo .";
    } else {
      cliHint = `hydra ${input.action}`;
    }
    return {
      content: `Action '${input.action}' is not available via HTTP API. Use the Hydra CLI: ${cliHint}`,
      is_error: true,
    };
  },
};
