import { z } from "zod";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";
import { getBrowseClient } from "./client.ts";

const inputSchema = z.object({
  action: z.enum([
    "goto", "click", "fill", "screenshot", "snapshot", "text", "scroll",
    "press", "select", "hover", "wait", "tabs", "tab", "cookies",
    "back", "reload", "console", "links", "url", "status",
  ]).describe("Browser automation command to execute"),
  url: z.string().optional().describe("URL to navigate to (for goto)"),
  selector: z.string().optional().describe("CSS selector (for click, fill, select, hover)"),
  value: z.string().optional().describe("Value to fill or select (for fill, select)"),
  key: z.string().optional().describe("Key to press (for press)"),
  direction: z.string().optional().describe("Scroll direction: up or down (for scroll)"),
  amount: z.number().optional().describe("Scroll amount in pixels (for scroll)"),
  timeout: z.number().optional().describe("Wait timeout in ms (for wait)"),
  tabId: z.number().optional().describe("Tab index to switch to (for tab)"),
});

/**
 * Convert named parameters to the positional string[] args
 * the browse server expects (same as CLI argv).
 */
function toArgs(input: z.infer<typeof inputSchema>): string[] {
  const { action } = input;
  switch (action) {
    case "goto":
      return input.url ? [input.url] : [];
    case "click":
    case "hover":
      return input.selector ? [input.selector] : [];
    case "fill":
      return [input.selector ?? "", input.value ?? ""];
    case "select":
      return [input.selector ?? "", input.value ?? ""];
    case "text":
      return input.selector ? [input.selector] : [];
    case "scroll":
      return [
        input.direction ?? "down",
        ...(input.amount !== undefined ? [String(input.amount)] : []),
      ];
    case "press":
      return input.key ? [input.key] : [];
    case "wait":
      return input.timeout !== undefined ? [String(input.timeout)] : [];
    case "tab":
      return input.tabId !== undefined ? [String(input.tabId)] : [];
    default:
      return [];
  }
}

export const browseTool: Tool<typeof inputSchema.shape> = {
  name: "BrowseAction",
  description: "Browser automation via the TermCanvas browse server: navigate, click, fill, screenshot, and more.",
  inputSchema,
  isReadOnly: false,

  async call(input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    const args = toArgs(input);
    const result = await getBrowseClient().command(input.action, args);
    return { content: JSON.stringify(result, null, 2) };
  },
};
