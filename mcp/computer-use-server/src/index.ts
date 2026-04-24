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
1. Call status to verify the helper is running and permissions are granted.
2. Call list_apps to discover running applications.
3. Call open_app to launch or activate the target app.
4. Call get_app_state with app_name to inspect the UI element tree and screenshot.
5. Interact using click, type_text, press_key, scroll, drag, set_value, or perform_secondary_action.
6. After each interaction, call get_app_state again to verify the result.

## Tips
- Prefer the integer element index from get_app_state over coordinates.
- Use coordinate_space="screenshot" for x/y coordinates read from the returned screenshot.
- Use coordinates for elements without accessibility representations (e.g., canvas-rendered content).
- Always verify after acting: call get_app_state after click/type/key to confirm the UI updated as expected.
- For text input, click the target field first, then use type_text.
- For keyboard shortcuts, use press_key with xdotool-like syntax such as key="super+c".
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
