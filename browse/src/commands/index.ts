import type { CommandHandler } from "../server.ts";

export function createCommandRegistry(): Map<string, CommandHandler> {
  const registry = new Map<string, CommandHandler>();
  // Commands are registered by individual modules as they are implemented
  return registry;
}
