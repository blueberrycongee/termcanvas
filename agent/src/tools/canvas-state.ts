import { z } from "zod";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";
import { getClient } from "./client.ts";

const inputSchema = z.object({});

export const canvasStateTool: Tool<typeof inputSchema.shape> = {
  name: "CanvasState",
  description: "Get the full TermCanvas canvas state including projects, worktrees, and terminals.",
  inputSchema,
  isReadOnly: true,

  async call(_input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    const result = await getClient().request("GET", "/state");
    return { content: JSON.stringify(result, null, 2) };
  },
};
