import { create } from "zustand";
import type { QuotaData } from "../types";

const MIN_COOLDOWN = 10 * 60_000;
const MAX_COOLDOWN = 40 * 60_000;

interface CodexQuotaStore {
  quota: QuotaData | null;
  loading: boolean;
  error: "rate_limited" | "unavailable" | null;
  lastFetchAt: number;
  cooldownMs: number;
  pendingRefresh: boolean;
  lastObservedCost: number;
  _cooldownTimer: ReturnType<typeof setTimeout> | null;
  fetch: () => Promise<void>;
  onCostChanged: (newCost: number) => void;
}

export const useCodexQuotaStore = create<CodexQuotaStore>((set, get) => ({
  quota: null,
  loading: false,
  error: null,
  lastFetchAt: 0,
  cooldownMs: MIN_COOLDOWN,
  pendingRefresh: false,
  lastObservedCost: 0,
  _cooldownTimer: null,

  fetch: async () => {
    if (get().loading) return;
    if (!window.termcanvas?.codexQuota) return;

    set({ loading: true });

    try {
      const result = await window.termcanvas.codexQuota.fetch();
      if (result.ok) {
        set({
          quota: result.data,
          loading: false,
          error: null,
          lastFetchAt: Date.now(),
          cooldownMs: MIN_COOLDOWN,
          pendingRefresh: false,
        });
      } else if (result.rateLimited) {
        set((s) => ({
          loading: false,
          error: "rate_limited",
          lastFetchAt: Date.now(),
          cooldownMs: Math.min(s.cooldownMs * 2, MAX_COOLDOWN),
          pendingRefresh: false,
        }));
      } else {
        set({
          loading: false,
          error: "unavailable",
          pendingRefresh: false,
        });
      }
    } catch {
      set({ loading: false, error: "unavailable", pendingRefresh: false });
    }
  },

  onCostChanged: (newCost: number) => {
    const state = get();
    if (newCost <= state.lastObservedCost) {
      set({ lastObservedCost: newCost });
      return;
    }

    set({ lastObservedCost: newCost });

    const elapsed = Date.now() - state.lastFetchAt;
    if (elapsed >= state.cooldownMs) {
      void get().fetch();
    } else if (!state.pendingRefresh) {
      set({ pendingRefresh: true });
      const remaining = state.cooldownMs - elapsed;
      if (state._cooldownTimer) clearTimeout(state._cooldownTimer);
      const timer = setTimeout(() => {
        set({ _cooldownTimer: null });
        void get().fetch();
      }, remaining);
      set({ _cooldownTimer: timer });
    }
  },
}));
