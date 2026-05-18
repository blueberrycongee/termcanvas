import { create } from "zustand";
import type {
  BlockingEvent,
  BlockingEventResolved,
} from "../../shared/blocking";

// Renderer-side mirror of the main-process bus. Exists purely for
// reactive UI — the truth is still in the main process. We rebuild
// from `blocking.list()` on mount so a late-subscribing renderer (e.g.
// reload during dev) catches up with already-open blocks.

interface BlockingStore {
  events: BlockingEvent[];
  add: (event: BlockingEvent) => void;
  remove: (resolved: BlockingEventResolved) => void;
  reset: (events: BlockingEvent[]) => void;
  firstTerminalId: () => string | null;
}

export const useBlockingStore = create<BlockingStore>((set, get) => ({
  events: [],
  add: (event) =>
    set((state) => {
      // Bus de-dupes by id, but the renderer can also receive a stale
      // re-open if the user reloads during an active block — mirror the
      // upsert semantics so we never double-count.
      const others = state.events.filter((e) => e.id !== event.id);
      return { events: [...others, event] };
    }),
  remove: (resolved) =>
    set((state) => ({
      events: state.events.filter((e) => e.id !== resolved.id),
    })),
  reset: (events) => set({ events }),
  firstTerminalId: () => get().events[0]?.terminalId ?? null,
}));

// Wire main-process events into the store. Returns a disposer; the
// caller (App.tsx) is responsible for cleanup on unmount, but in
// practice this lives for the entire renderer lifetime.
export function startBlockingBridge(): () => void {
  const api = window.termcanvas?.blocking;
  if (!api) {
    return () => {};
  }

  void api.list().then((events) => {
    useBlockingStore.getState().reset(events);
  });

  const offOpen = api.onOpened((event) => {
    useBlockingStore.getState().add(event);
  });
  const offResolve = api.onResolved((resolved) => {
    useBlockingStore.getState().remove(resolved);
  });

  return () => {
    offOpen();
    offResolve();
  };
}
