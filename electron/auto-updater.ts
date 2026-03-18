import { autoUpdater } from "electron-updater";
import { BrowserWindow, ipcMain, app } from "electron";
import fs from "fs";
import path from "path";
import { sendToWindow } from "./window-events";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let checkTimer: ReturnType<typeof setInterval> | null = null;

export function setupAutoUpdater(window: BrowserWindow): void {
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
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle("updater:check", () => {
    return autoUpdater.checkForUpdates().catch(() => null);
  });

  ipcMain.handle("updater:get-version", () => {
    return app.getVersion();
  });

  // Initial check after a short delay, then periodic
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  checkTimer = setInterval(
    () => autoUpdater.checkForUpdates().catch(() => {}),
    CHECK_INTERVAL_MS,
  );
}

export function stopAutoUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

function cleanUpdaterCache(): void {
  const cacheDir = getUpdaterCacheDir();
  if (!cacheDir || !fs.existsSync(cacheDir)) return;

  try {
    const entries = fs.readdirSync(cacheDir);
    for (const entry of entries) {
      const full = path.join(cacheDir, entry);
      const stat = fs.statSync(full);
      // Remove files older than 7 days
      if (Date.now() - stat.mtimeMs > 7 * 24 * 60 * 60 * 1000) {
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
    case "darwin":
      return path.join(app.getPath("home"), "Library", "Caches", name);
    case "win32":
      return path.join(app.getPath("appData"), "..", "Local", name);
    case "linux":
      return path.join(app.getPath("home"), ".cache", name);
    default:
      return null;
  }
}
