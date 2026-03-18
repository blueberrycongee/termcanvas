import { create } from "zustand";
import type { UsageSummary } from "../types";

interface UsageStore {
  summary: UsageSummary | null;
  loading: boolean;
  date: string; // YYYY-MM-DD
  fetch: (dateStr?: string) => Promise<void>;
}

function todayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const useUsageStore = create<UsageStore>((set, get) => ({
  summary: null,
  loading: false,
  date: todayStr(),

  fetch: async (dateStr?: string) => {
    const target = dateStr ?? get().date;
    set({ loading: true, date: target });

    if (!window.termcanvas?.usage) {
      set({ loading: false });
      return;
    }

    try {
      const summary = await window.termcanvas.usage.query(target);
      // Only update if the date hasn't changed during the async call
      if (get().date === target) {
        set({ summary, loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },
}));
