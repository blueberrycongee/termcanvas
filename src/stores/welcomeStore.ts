import { create } from "zustand";

const STORAGE_KEY = "termcanvas-welcome-seen";

interface WelcomeStore {
  open: boolean;
  openTutorial: () => void;
  closeTutorial: () => void;
}

function readInitialOpen(): boolean {
  if (typeof window === "undefined") return false;
  return !window.localStorage.getItem(STORAGE_KEY);
}

export const useWelcomeStore = create<WelcomeStore>((set) => ({
  open: readInitialOpen(),
  openTutorial: () => set({ open: true }),
  closeTutorial: () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
    set({ open: false });
  },
}));
