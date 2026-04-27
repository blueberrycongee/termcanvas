import type { StoreApi } from "zustand";

interface UpdateRecord {
  count: number;
  lastWarned: number;
}

const updateCounts = new Map<string, UpdateRecord>();

export function wrapSetState<T>(
  name: string,
  set: StoreApi<T>["setState"],
): StoreApi<T>["setState"] {
  return (partial, replace) => {
    const record = updateCounts.get(name) ?? { count: 0, lastWarned: 0 };
    record.count++;
    const now = Date.now();
    if (now - record.lastWarned > 1000) {
      record.lastWarned = now;
      if (record.count > 50) {
        console.warn(
          `[DEBUG] Store "${name}" updated ${record.count} times in the last second. Possible infinite loop.`,
        );
        console.warn(new Error().stack);
      }
      record.count = 0;
    }
    updateCounts.set(name, record);
    // Cast: zustand's setState is two overloads (replace?: false vs replace: true);
    // forwarding `partial` and `replace` as a single pair doesn't satisfy either,
    // but the wrapper preserves runtime semantics so a single cast is fine.
    return (set as (p: typeof partial, r?: typeof replace) => void)(partial, replace);
  };
}
