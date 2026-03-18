import { create } from "zustand";
import type { UpdateEventInfo } from "../types";

export type UpdateStatus = "idle" | "checking" | "downloading" | "ready" | "error";

interface UpdaterStore {
  status: UpdateStatus;
  info: UpdateEventInfo | null;
  downloadPercent: number;
  errorMessage: string | null;
}

export const useUpdaterStore = create<UpdaterStore>(() => ({
  status: "idle",
  info: null,
  downloadPercent: 0,
  errorMessage: null,
}));

/** Call once at app startup to wire IPC events into the store. */
export function initUpdaterListeners(): () => void {
  const cleanups: (() => void)[] = [];

  cleanups.push(
    window.termcanvas.updater.onUpdateAvailable((info) => {
      useUpdaterStore.setState({ status: "downloading", info, downloadPercent: 0 });
    }),
  );

  cleanups.push(
    window.termcanvas.updater.onDownloadProgress((progress) => {
      useUpdaterStore.setState({ downloadPercent: progress.percent });
    }),
  );

  cleanups.push(
    window.termcanvas.updater.onUpdateDownloaded((info) => {
      useUpdaterStore.setState({ status: "ready", info, downloadPercent: 100 });
    }),
  );

  cleanups.push(
    window.termcanvas.updater.onError((error) => {
      useUpdaterStore.setState({ status: "error", errorMessage: error.message });
    }),
  );

  return () => cleanups.forEach((fn) => fn());
}
