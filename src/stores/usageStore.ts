import { create } from "zustand";
import type { UsageSummary } from "../types";

interface UsageStore {
  summary: UsageSummary | null;
  loading: boolean;
  date: string; // YYYY-MM-DD
  /** Tracks which dates are known to have usage data (scheme B: only after visit) */
  cachedDates: Record<string, boolean>;
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
  cachedDates: {},

  fetch: async (dateStr?: string) => {
    // Guard against overlapping requests
    if (get().loading) return;

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
        const hasData = summary.sessions > 0 || summary.totalCost > 0;
        set((state) => ({
          summary,
          loading: false,
          cachedDates: { ...state.cachedDates, [target]: hasData },
        }));
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },
}));
