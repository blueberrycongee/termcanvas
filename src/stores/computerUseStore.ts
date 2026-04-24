import { create } from "zustand";

interface ComputerUseStore {
  enabled: boolean;
  helperRunning: boolean;
  accessibilityGranted: boolean | null;
  screenRecordingGranted: boolean | null;
  error: string | null;
  loading: boolean;
  fetchStatus: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  stop: () => Promise<void>;
  openPermissions: () => void;
}

export const useComputerUseStore = create<ComputerUseStore>((set) => ({
  enabled: false,
  helperRunning: false,
  accessibilityGranted: null,
  screenRecordingGranted: null,
  error: null,
  loading: false,
  fetchStatus: async () => {
    set({ loading: true });
    try {
      const status = await window.termcanvas.computerUse.status();
      set({ ...status, error: null, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  enable: async () => {
    set({ loading: true, error: null });
    try {
      await window.termcanvas.computerUse.enable();
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  disable: async () => {
    set({ loading: true, error: null });
    try {
      await window.termcanvas.computerUse.disable();
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  stop: async () => {
    try {
      await window.termcanvas.computerUse.stop();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  openPermissions: () => {
    window.termcanvas.computerUse.openPermissions();
  },
}));
