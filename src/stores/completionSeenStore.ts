import { create } from "zustand";

interface CompletionSeenStore {
  seenTerminalIds: Set<string>;
  markSeen: (terminalId: string) => void;
  syncActiveDoneIds: (terminalIds: Iterable<string>) => void;
}

function buildTrimmedSeenIds(
  current: Set<string>,
  activeDoneIds: Set<string>,
): Set<string> {
  const next = new Set<string>();
  for (const terminalId of current) {
    if (activeDoneIds.has(terminalId)) {
      next.add(terminalId);
    }
  }
  return next;
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

export const useCompletionSeenStore = create<CompletionSeenStore>((set) => ({
  seenTerminalIds: new Set(),

  markSeen: (terminalId) =>
    set((state) => {
      if (state.seenTerminalIds.has(terminalId)) {
        return state;
      }
      const next = new Set(state.seenTerminalIds);
      next.add(terminalId);
      return { seenTerminalIds: next };
    }),

  syncActiveDoneIds: (terminalIds) =>
    set((state) => {
      const activeDoneIds = new Set(terminalIds);
      const next = buildTrimmedSeenIds(state.seenTerminalIds, activeDoneIds);
      if (sameSet(next, state.seenTerminalIds)) {
        return state;
      }
      return { seenTerminalIds: next };
    }),
}));
