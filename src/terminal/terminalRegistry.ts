const registry = new Map<string, () => string | null>();

export function registerTerminal(id: string, serialize: () => string | null) {
  registry.set(id, serialize);
}

export function unregisterTerminal(id: string) {
  registry.delete(id);
}

export function serializeTerminal(id: string): string | null {
  const serialize = registry.get(id);
  if (!serialize) return null;
  try {
    return serialize();
  } catch {
    return null;
  }
}

export function serializeAllTerminals(): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [id, serialize] of registry) {
    try {
      result[id] = serialize();
    } catch {
      // Terminal may be disposed
    }
  }
  return result;
}
