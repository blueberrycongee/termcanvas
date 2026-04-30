import { create } from "zustand";
import type {
  UsageSummary,
  CloudUsageSummary,
  UsageRangeSummary,
} from "../types";

export interface HeatmapEntry {
  tokens: number;
  cost: number;
}

interface UsageStore {
  summary: UsageSummary | null;
  loading: boolean;
  date: string; // YYYY-MM-DD
  cachedDates: Record<string, boolean>;
  summaryCache: Record<string, UsageSummary>;
  summaryFetchedAt: Record<string, number>;
  /** When a fetch is in-flight, stores the latest requested date so it's fetched next */
  pendingDate: string | null;
  fetch: (dateStr?: string) => Promise<void>;
  rangeSummary: UsageRangeSummary | null;
  rangeLoading: boolean;
  rangeCache: Record<string, UsageRangeSummary>;
  rangeFetchedAt: Record<string, number>;
  fetchRange: (startDate: string, endDate: string) => Promise<void>;

  heatmapData: Record<string, HeatmapEntry>;
  heatmapLoading: boolean;
  heatmapError: boolean;
  heatmapFetchedAt: number;
  fetchHeatmap: () => Promise<void>;

  cloudSummary: CloudUsageSummary | null;
  cloudHeatmapData: Record<string, { tokens: number; cost: number }> | null;
  cloudSummaryFetchedAt: number;
  cloudHeatmapFetchedAt: number;
  fetchCloud: (dateStr?: string) => Promise<void>;
  fetchCloudHeatmap: () => Promise<void>;
}

const TODAY_SUMMARY_STALE_MS = 30_000;
const HEATMAP_STALE_MS = 5 * 60_000;
const CLOUD_SUMMARY_STALE_MS = 60_000;
const CLOUD_HEATMAP_STALE_MS = 5 * 60_000;

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
  summaryFetchedAt: {},
  pendingDate: null,
  rangeSummary: null,
  rangeLoading: false,
  rangeCache: {},
  rangeFetchedAt: {},

  fetch: async (dateStr?: string) => {
    const target = dateStr ?? get().date;

    // Serve from cache for non-today dates (historical data doesn't change)
    const isToday = target === todayStr();
    const cached = get().summaryCache[target];
    const fetchedAt = get().summaryFetchedAt[target] ?? 0;
    const isFreshToday = isToday && Date.now() - fetchedAt < TODAY_SUMMARY_STALE_MS;
    if (cached && (!isToday || isFreshToday)) {
      set({ date: target, summary: cached });
      return;
    }

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
        summaryFetchedAt: { ...state.summaryFetchedAt, [target]: Date.now() },
      }));
    } catch {
      set({ loading: false });
    }

    const pending = get().pendingDate;
    if (pending) {
      set({ pendingDate: null });
      get().fetch(pending);
    }
  },

  fetchRange: async (startDate: string, endDate: string) => {
    const key = `${startDate}:${endDate}`;
    const cached = get().rangeCache[key];
    const fetchedAt = get().rangeFetchedAt[key] ?? 0;
    if (cached && Date.now() - fetchedAt < HEATMAP_STALE_MS) {
      set({ rangeSummary: cached });
      return;
    }

    if (!window.termcanvas?.usage?.queryRange) {
      set({ rangeSummary: null });
      return;
    }

    set({ rangeLoading: true });
    try {
      const rangeSummary = await window.termcanvas.usage.queryRange(
        startDate,
        endDate,
      );
      set((state) => ({
        rangeSummary,
        rangeLoading: false,
        rangeCache: { ...state.rangeCache, [key]: rangeSummary },
        rangeFetchedAt: { ...state.rangeFetchedAt, [key]: Date.now() },
      }));
    } catch {
      set({ rangeLoading: false });
    }
  },

  heatmapData: {},
  heatmapLoading: false,
  heatmapError: false,
  heatmapFetchedAt: 0,

  fetchHeatmap: async () => {
    if (get().heatmapLoading) return;
    if (
      Object.keys(get().heatmapData).length > 0 &&
      Date.now() - get().heatmapFetchedAt < HEATMAP_STALE_MS
    ) {
      return;
    }

    if (!window.termcanvas?.usage?.heatmap) {
      set({ heatmapError: true });
      return;
    }

    set({ heatmapLoading: true, heatmapError: false });

    try {
      const data = await window.termcanvas.usage.heatmap();
      set({ heatmapData: data, heatmapLoading: false, heatmapFetchedAt: Date.now() });
    } catch {
      set({ heatmapLoading: false, heatmapError: true });
    }
  },

  cloudSummary: null,
  cloudHeatmapData: null,
  cloudSummaryFetchedAt: 0,
  cloudHeatmapFetchedAt: 0,

  fetchCloud: async (dateStr?: string) => {
    const target = dateStr ?? get().date;
    if (
      !dateStr &&
      get().cloudSummary &&
      Date.now() - get().cloudSummaryFetchedAt < CLOUD_SUMMARY_STALE_MS
    ) {
      return;
    }
    // @ts-expect-error -- queryCloud will be added by the preload agent
    if (!window.termcanvas?.usage?.queryCloud) {
      set({ cloudSummary: null });
      return;
    }
    try {
      // @ts-expect-error -- queryCloud will be added by the preload agent
      const data = await window.termcanvas.usage.queryCloud(target);
      set({ cloudSummary: data ?? null, cloudSummaryFetchedAt: Date.now() });
    } catch {
      set({ cloudSummary: null });
    }
  },

  fetchCloudHeatmap: async () => {
    if (
      get().cloudHeatmapData &&
      Date.now() - get().cloudHeatmapFetchedAt < CLOUD_HEATMAP_STALE_MS
    ) {
      return;
    }
    // @ts-expect-error -- heatmapCloud will be added by the preload agent
    if (!window.termcanvas?.usage?.heatmapCloud) {
      set({ cloudHeatmapData: null });
      return;
    }
    try {
      // @ts-expect-error -- heatmapCloud will be added by the preload agent
      const data = await window.termcanvas.usage.heatmapCloud();
      set({ cloudHeatmapData: data ?? null, cloudHeatmapFetchedAt: Date.now() });
    } catch {
      set({ cloudHeatmapData: null });
    }
  },
}));
