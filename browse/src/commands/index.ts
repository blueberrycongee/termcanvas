import type { CommandHandler } from "../server.ts";
import { navigationCommands } from "./navigation.ts";
import { inspectCommands } from "./inspect.ts";
import { interactCommands } from "./interact.ts";
import { metaCommands } from "./meta.ts";

export function createCommandRegistry(): Map<string, CommandHandler> {
  const registry = new Map<string, CommandHandler>();
  for (const [k, v] of navigationCommands) registry.set(k, v);
  for (const [k, v] of inspectCommands) registry.set(k, v);
  for (const [k, v] of interactCommands) registry.set(k, v);
  for (const [k, v] of metaCommands) registry.set(k, v);
  return registry;
}
