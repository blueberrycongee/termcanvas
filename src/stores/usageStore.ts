import { create } from "zustand";
import type { UsageSummary } from "../types";

export interface HeatmapEntry {
  tokens: number;
  cost: number;
}

interface UsageStore {
  summary: UsageSummary | null;
  loading: boolean;
  date: string; // YYYY-MM-DD
  /** Tracks which dates are known to have usage data (scheme B: only after visit) */
  cachedDates: Record<string, boolean>;
  fetch: (dateStr?: string) => Promise<void>;

  heatmapData: Record<string, HeatmapEntry>;
  heatmapLoading: boolean;
  heatmapError: boolean;
  fetchHeatmap: () => Promise<void>;
}

function todayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const HEATMAP_DAYS = 91;
const HEATMAP_CONCURRENCY = 10;

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

  heatmapData: {},
  heatmapLoading: false,
  heatmapError: false,

  fetchHeatmap: async () => {
    if (get().heatmapLoading) return;
    // Skip if we already have data
    if (Object.keys(get().heatmapData).length > 0) return;

    if (!window.termcanvas?.usage) {
      set({ heatmapError: true });
      return;
    }

    set({ heatmapLoading: true, heatmapError: false });

    const today = new Date();
    const dates: string[] = [];
    for (let i = 0; i < HEATMAP_DAYS; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(toDateStr(d));
    }

    const result: Record<string, HeatmapEntry> = {};
    let failed = 0;

    // Process in batches for throttling
    for (let i = 0; i < dates.length; i += HEATMAP_CONCURRENCY) {
      const batch = dates.slice(i, i + HEATMAP_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((dateStr) => window.termcanvas!.usage.query(dateStr)),
      );

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        const dateStr = batch[j];
        if (r.status === "fulfilled") {
          const s = r.value;
          const tokens = s.totalInput + s.totalOutput + s.totalCacheRead + s.totalCacheCreate5m + s.totalCacheCreate1h;
          result[dateStr] = { tokens, cost: s.totalCost };
        } else {
          failed++;
        }
      }
    }

    if (failed === dates.length) {
      set({ heatmapLoading: false, heatmapError: true });
    } else {
      set({ heatmapData: result, heatmapLoading: false });
    }
  },
}));
