import { create } from "zustand";

type SettingsTab = "general" | "shortcuts" | "agents";

interface SettingsModalStore {
  open: boolean;
  initialTab: SettingsTab;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
}

export type { SettingsTab };

export const useSettingsModalStore = create<SettingsModalStore>((set) => ({
  open: false,
  initialTab: "general",
  openSettings: (tab = "general") => set({ open: true, initialTab: tab }),
  closeSettings: () => set({ open: false }),
}));
