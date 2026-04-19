import { create } from "zustand";
import type { UpdateEventInfo } from "../types";
import { useNotificationStore } from "./notificationStore";
import { useLocaleStore } from "./localeStore";
import { en } from "../i18n/en";
import { zh } from "../i18n/zh";

export type UpdateStatus = "idle" | "checking" | "downloading" | "ready" | "error";

interface UpdaterStore {
  status: UpdateStatus;
  info: UpdateEventInfo | null;
  downloadPercent: number;
  errorMessage: string | null;
  installOnCloseRequested: boolean;
  requestRestartOnClose: () => void;
  cancelRestartOnClose: () => void;
  consumeRestartOnClose: () => boolean;
}

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  status: "idle",
  info: null,
  downloadPercent: 0,
  errorMessage: null,
  installOnCloseRequested: false,
  requestRestartOnClose: () => set({ installOnCloseRequested: true }),
  cancelRestartOnClose: () => set({ installOnCloseRequested: false }),
  consumeRestartOnClose: () => {
    const requested = get().installOnCloseRequested;
    if (requested) {
      set({ installOnCloseRequested: false });
    }
    return requested;
  },
}));

export function initUpdaterListeners(): () => void {
  if (!window.termcanvas?.updater) {
    return () => {};
  }

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

  if (window.termcanvas.updater.onLocationWarning) {
    cleanups.push(
      window.termcanvas.updater.onLocationWarning(() => {
        const locale = useLocaleStore.getState().locale;
        const dict = locale === "zh" ? { ...en, ...zh } : en;
        useNotificationStore
          .getState()
          .notify("warn", dict.update_location_warning);
      }),
    );
  }

  return () => cleanups.forEach((fn) => fn());
}
