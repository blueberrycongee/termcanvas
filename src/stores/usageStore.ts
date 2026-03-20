import { create } from "zustand";
import type { UsageSummary, CloudUsageSummary } from "../types";

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
  /** In-memory cache of fetched summaries by date */
  summaryCache: Record<string, UsageSummary>;
  /** When a fetch is in-flight, stores the latest requested date so it's fetched next */
  pendingDate: string | null;
  fetch: (dateStr?: string) => Promise<void>;

  heatmapData: Record<string, HeatmapEntry>;
  heatmapLoading: boolean;
  heatmapError: boolean;
  fetchHeatmap: () => Promise<void>;

  cloudSummary: CloudUsageSummary | null;
  cloudHeatmapData: Record<string, { tokens: number; cost: number }> | null;
  fetchCloud: (dateStr?: string) => Promise<void>;
  fetchCloudHeatmap: () => Promise<void>;
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
  summaryCache: {},
  pendingDate: null,

  fetch: async (dateStr?: string) => {
    const target = dateStr ?? get().date;

    // Serve from cache for non-today dates (historical data doesn't change)
    const isToday = target === todayStr();
    const cached = get().summaryCache[target];
    if (cached && !isToday) {
      set({ date: target, summary: cached });
      return;
    }

    // If already loading, queue the latest request instead of dropping it
    if (get().loading) {
      set({ pendingDate: target });
      return;
    }

    set({ loading: true, date: target, pendingDate: null });

    if (!window.termcanvas?.usage) {
      set({ loading: false });
      return;
    }

    try {
      const summary = await window.termcanvas.usage.query(target);
      const hasData = summary.sessions > 0 || summary.totalCost > 0;
      set((state) => ({
        summary: state.date === target ? summary : state.summary,
        loading: false,
        cachedDates: { ...state.cachedDates, [target]: hasData },
        summaryCache: { ...state.summaryCache, [target]: summary },
      }));
    } catch {
      set({ loading: false });
    }

    // Process the latest pending request
    const pending = get().pendingDate;
    if (pending) {
      set({ pendingDate: null });
      get().fetch(pending);
    }
  },

  heatmapData: {},
  heatmapLoading: false,
  heatmapError: false,

  fetchHeatmap: async () => {
    if (get().heatmapLoading) return;
    if (Object.keys(get().heatmapData).length > 0) return;

    if (!window.termcanvas?.usage?.heatmap) {
      set({ heatmapError: true });
      return;
    }

    set({ heatmapLoading: true, heatmapError: false });

    try {
      const data = await window.termcanvas.usage.heatmap();
      set({ heatmapData: data, heatmapLoading: false });
    } catch {
      set({ heatmapLoading: false, heatmapError: true });
    }
  },

  cloudSummary: null,
  cloudHeatmapData: null,

  fetchCloud: async (dateStr?: string) => {
    const target = dateStr ?? get().date;
    // @ts-expect-error -- queryCloud will be added by the preload agent
    if (!window.termcanvas?.usage?.queryCloud) {
      set({ cloudSummary: null });
      return;
    }
    try {
      // @ts-expect-error -- queryCloud will be added by the preload agent
      const data = await window.termcanvas.usage.queryCloud(target);
      set({ cloudSummary: data ?? null });
    } catch {
      set({ cloudSummary: null });
    }
  },

  fetchCloudHeatmap: async () => {
    // @ts-expect-error -- heatmapCloud will be added by the preload agent
    if (!window.termcanvas?.usage?.heatmapCloud) {
      set({ cloudHeatmapData: null });
      return;
    }
    try {
      // @ts-expect-error -- heatmapCloud will be added by the preload agent
      const data = await window.termcanvas.usage.heatmapCloud();
      set({ cloudHeatmapData: data ?? null });
    } catch {
      set({ cloudHeatmapData: null });
    }
  },
}));
