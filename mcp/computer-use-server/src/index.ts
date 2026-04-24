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
import {
  COMPUTER_USE_INSTRUCTIONS_URI,
  readComputerUseInstructions,
} from "./instructions.js";

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
      uri: COMPUTER_USE_INSTRUCTIONS_URI,
      name: "Computer Use Instructions",
      description:
        "Best practices and workflow guide for using TermCanvas Computer Use tools effectively",
      mimeType: "text/plain",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === COMPUTER_USE_INSTRUCTIONS_URI) {
    return {
      contents: [
        {
          uri: COMPUTER_USE_INSTRUCTIONS_URI,
          mimeType: "text/plain",
          text: readComputerUseInstructions(),
        },
      ],
    };
  }
  throw new Error(`Unknown resource: ${request.params.uri}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
