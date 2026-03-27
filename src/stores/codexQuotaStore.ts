import { create } from "zustand";
import type { QuotaData } from "../types";

interface CodexQuotaStore {
  quota: QuotaData | null;
  loading: boolean;
  error: "rate_limited" | "unavailable" | null;
  fetch: () => Promise<void>;
}

export const useCodexQuotaStore = create<CodexQuotaStore>((set, get) => ({
  quota: null,
  loading: false,
  error: null,

  fetch: async () => {
    if (get().loading) return;
    if (!window.termcanvas?.codexQuota) return;

    set({ loading: true });

    try {
      const result = await window.termcanvas.codexQuota.fetch();
      if (result.ok) {
        set({ quota: result.data, loading: false, error: null });
      } else if (result.rateLimited) {
        set({ loading: false, error: "rate_limited" });
      } else {
        set({ loading: false, error: "unavailable" });
      }
    } catch {
      set({ loading: false, error: "unavailable" });
    }
  },
}));
