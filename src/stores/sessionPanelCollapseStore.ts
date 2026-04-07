import { create } from "zustand";

interface SessionPanelCollapseStore {
  collapsed: Set<string>;
  toggle: (id: string) => void;
  isCollapsed: (id: string) => boolean;
}

export const useSessionPanelCollapseStore = create<SessionPanelCollapseStore>(
  (set, get) => ({
    collapsed: new Set(),

    toggle: (id) =>
      set((state) => {
        const next = new Set(state.collapsed);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return { collapsed: next };
      }),

    isCollapsed: (id) => get().collapsed.has(id),
  }),
);
