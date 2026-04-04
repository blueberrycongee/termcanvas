import type { Terminal } from "@xterm/xterm";
import { SerializeAddon } from "@xterm/addon-serialize";

const registry = new Map<
  string,
  { xterm: Terminal; serialize: SerializeAddon }
>();

export function registerTerminal(
  id: string,
  xterm: Terminal,
  serialize: SerializeAddon,
) {
  registry.set(id, { xterm, serialize });
}

export function unregisterTerminal(id: string) {
  registry.delete(id);
}

export function serializeTerminal(id: string): string | null {
  const entry = registry.get(id);
  if (!entry) return null;
  return entry.serialize.serialize();
}

export function serializeAllTerminals(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [id, entry] of registry) {
    try {
      result[id] = entry.serialize.serialize();
    } catch {
    }
  }
  return result;
}
