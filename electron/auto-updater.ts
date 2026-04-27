import { autoUpdater } from "electron-updater";
import { BrowserWindow, ipcMain, app } from "electron";
import fs from "fs";
import path from "path";
import { sendToWindow } from "./window-events";
import { MacCustomUpdater } from "./mac-updater";
import type { UpdateCheckOutcome } from "../shared/updater-types";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const IS_MAC = process.platform === "darwin";
const IS_DEV = !!process.env.VITE_DEV_SERVER_URL;

let checkTimer: ReturnType<typeof setInterval> | null = null;
let macUpdater: MacCustomUpdater | null = null;

export function installDownloadedUpdate(): void {
  if (IS_DEV) return;

  if (IS_MAC) {
    macUpdater?.quitAndInstall();
    return;
  }

  autoUpdater.quitAndInstall(false, true);
}

export function setupAutoUpdater(window: BrowserWindow): void {
  ipcMain.handle("updater:get-version", () => app.getVersion());

  if (IS_DEV) {
    ipcMain.handle("updater:check", () => null);
    return;
  }

  const checkFn = IS_MAC
    ? setupMacUpdater(window)
    : setupElectronUpdater(window);

  setTimeout(() => checkFn(), 5000);
  checkTimer = setInterval(() => checkFn(), CHECK_INTERVAL_MS);
}

export function stopAutoUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}


function setupMacUpdater(window: BrowserWindow): () => void {
  macUpdater = new MacCustomUpdater(window);
  macUpdater.registerAutoInstallOnQuit();

  ipcMain.on("updater:install", () => {
    installDownloadedUpdate();
  });

  ipcMain.handle("updater:check", async (): Promise<UpdateCheckOutcome> => {
    try {
      return (await macUpdater?.checkForUpdates()) ?? "skipped";
    } catch {
      return "skipped";
    }
  });

  return () => {
    macUpdater?.checkForUpdates().catch(() => {});
  };
}

function setupElectronUpdater(window: BrowserWindow): () => void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  cleanUpdaterCache();

  autoUpdater.on("update-available", (info) => {
    sendToWindow(window, "updater:update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes ?? "",
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendToWindow(window, "updater:download-progress", {
      percent: progress.percent,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendToWindow(window, "updater:update-downloaded", {
      version: info.version,
      releaseNotes: info.releaseNotes ?? "",
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on("error", (error) => {
    sendToWindow(window, "updater:error", {
      message: error.message,
    });
  });

  ipcMain.on("updater:install", () => {
    installDownloadedUpdate();
  });

  ipcMain.handle("updater:check", async (): Promise<UpdateCheckOutcome> => {
    try {
      const result = await autoUpdater.checkForUpdates();
      // electron-updater attaches a cancellationToken only when it
      // actually started a download, i.e. a newer version was found.
      // Absent → confirmed up to date. Result missing entirely → unable
      // to check (treat as skipped so handleCheck doesn't render
      // "up to date").
      if (!result) return "skipped";
      return result.cancellationToken ? "newer" : "up-to-date";
    } catch {
      return "skipped";
    }
  });

  return () => {
    autoUpdater.checkForUpdates().catch(() => {});
  };
}

// Cache cleanup (electron-updater only, not used on macOS)

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function cleanUpdaterCache(): void {
  const cacheDir = getUpdaterCacheDir();
  if (!cacheDir || !fs.existsSync(cacheDir)) return;

  try {
    for (const entry of fs.readdirSync(cacheDir)) {
      const full = path.join(cacheDir, entry);
      const stat = fs.statSync(full);
      if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

function getUpdaterCacheDir(): string | null {
  const name = `${app.getName()}-updater`;
  switch (process.platform) {
    case "win32":
      return path.join(app.getPath("appData"), "..", "Local", name);
    case "linux":
      return path.join(app.getPath("home"), ".cache", name);
    default:
      return null;
  }
}
