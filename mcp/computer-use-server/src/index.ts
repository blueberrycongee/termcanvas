#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { HelperClient } from "./helper-client.js";
import { tools } from "./tools.js";
import { handleToolCall } from "./handler.js";

const INSTRUCTIONS_URI = "termcanvas://computer-use/instructions";

const INSTRUCTIONS = `# Computer Use — Best Practices

## Workflow
1. Call computer_use_status to verify the helper is running and permissions are granted.
2. Call computer_use_list_apps to discover running applications.
3. Call computer_use_open_app to launch or activate the target app.
4. Call computer_use_get_app_state (with the app's PID) to inspect the UI element tree and optionally capture a screenshot.
5. Interact using computer_use_click, computer_use_type_text, computer_use_press_key, computer_use_scroll, or computer_use_drag.
6. After each interaction, call computer_use_get_app_state again to verify the result.

## Tips
- Prefer element_id over coordinates. Element IDs from get_app_state are stable across minor layout changes and adapt to window position.
- Use coordinates only for elements without accessibility representations (e.g., canvas-rendered content).
- Always verify after acting: call get_app_state after click/type/key to confirm the UI updated as expected.
- Use include_screenshot=true in get_app_state when you need visual context to understand the layout.
- For text input, click the target field first, then use type_text.
- For keyboard shortcuts, use press_key with modifiers (e.g., key="c", modifiers=["command"] for Cmd+C).
`;

const client = new HelperClient();

const server = new Server(
  {
    name: "termcanvas-computer-use",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(name, (args ?? {}) as Record<string, unknown>, client);
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: INSTRUCTIONS_URI,
      name: "Computer Use Instructions",
      description:
        "Best practices and workflow guide for using TermCanvas Computer Use tools effectively",
      mimeType: "text/plain",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === INSTRUCTIONS_URI) {
    return {
      contents: [
        {
          uri: INSTRUCTIONS_URI,
          mimeType: "text/plain",
          text: INSTRUCTIONS,
        },
      ],
    };
  }
  throw new Error(`Unknown resource: ${request.params.uri}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
