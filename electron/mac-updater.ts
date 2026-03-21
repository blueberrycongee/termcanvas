import { app, net } from "electron";
import {
  createWriteStream,
  mkdirSync,
  rmSync,
  readdirSync,
  existsSync,
  createReadStream,
  writeFileSync,
  readFileSync,
  accessSync,
  constants,
} from "fs";
import { join, resolve, dirname } from "path";
import { createHash } from "crypto";
import { spawn, execFile } from "child_process";
import type { BrowserWindow } from "electron";
import { sendToWindow } from "./window-events";

const GITHUB_OWNER = "blueberrycongee";
const GITHUB_REPO = "termcanvas";
const MAX_DOWNLOAD_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2000;
const INSTALL_WAIT_TIMEOUT_S = 30;

interface ReleaseFile {
  url: string;
  sha512: string;
  size: number;
}

interface ReleaseInfo {
  version: string;
  files: ReleaseFile[];
  releaseDate: string;
}

interface PendingUpdate {
  version: string;
  appPath: string;
  releaseNotes: string;
  releaseDate: string;
}

/** Serialized to disk so pending updates survive app restarts. */
interface UpdateState extends PendingUpdate {
  downloadedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the latest-mac.yml produced by electron-builder.
 *
 * Format:
 *   version: X.Y.Z
 *   files:
 *     - url: Name.zip
 *       sha512: base64hash
 *       size: 12345
 *   releaseDate: 'ISO-string'
 */
function parseLatestYml(content: string): ReleaseInfo {
  const version = content.match(/^version:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const releaseDate =
    content.match(/^releaseDate:\s*'?(.+?)'?$/m)?.[1]?.trim() ?? "";

  const files: ReleaseFile[] = [];
  const parts = content.split(/\n\s+-\s+url:\s*/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const url = block.split("\n")[0].trim();
    const sha512 = block.match(/sha512:\s*(.+)/)?.[1]?.trim() ?? "";
    const size = parseInt(block.match(/size:\s*(\d+)/)?.[1] ?? "0", 10);
    files.push({ url, sha512, size });
  }

  return { version, files, releaseDate };
}

/** Returns true if version `a` is strictly newer than `b`. */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

/** Fetch text from a URL using Electron's net module (follows redirects). */
function fetchText(url: string, userAgent?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    if (userAgent) request.setHeader("User-Agent", userAgent);

    let data = "";
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} from ${url}`));
        return;
      }
      response.on("data", (chunk) => {
        data += chunk.toString();
      });
      response.on("end", () => resolve(data));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

/** Download a file with progress reporting. */
function downloadFile(
  url: string,
  destPath: string,
  expectedSize: number,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    const stream = createWriteStream(destPath);
    let received = 0;
    let settled = false;

    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      stream.destroy();
      reject(err);
    };

    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        fail(new Error(`HTTP ${response.statusCode} downloading update`));
        return;
      }
      response.on("data", (chunk) => {
        stream.write(chunk);
        received += chunk.length;
        if (expectedSize > 0) {
          onProgress(Math.min(100, (received / expectedSize) * 100));
        }
      });
      response.on("end", () => {
        stream.end(() => {
          settled = true;
          resolve();
        });
      });
      response.on("error", fail);
    });
    request.on("error", fail);
    request.end();
  });
}

/** Download with automatic retry and exponential backoff. */
async function downloadWithRetry(
  url: string,
  destPath: string,
  expectedSize: number,
  onProgress: (percent: number) => void,
): Promise<void> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
    try {
      await downloadFile(url, destPath, expectedSize, onProgress);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_DOWNLOAD_RETRIES) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/** Compute SHA-512 hash of a file, returned as base64 (streaming). */
function computeSha512(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("base64")));
    stream.on("error", reject);
  });
}

/** Extract a ZIP file using macOS ditto (preserves attributes, handles unicode). */
function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(destDir, { recursive: true });
    execFile("ditto", ["-xk", zipPath, destDir], (err) => {
      if (err) reject(new Error(`Failed to extract update: ${err.message}`));
      else resolve();
    });
  });
}

function getStagingDir(): string {
  return join(app.getPath("userData"), "pending-update");
}

function getStatePath(): string {
  return join(getStagingDir(), "state.json");
}

function getAppBundlePath(): string {
  // app.getAppPath() → /path/to/App.app/Contents/Resources/app.asar
  return resolve(app.getAppPath(), "../../..");
}

/** Check if the .app bundle location is writable (fails for DMG mounts). */
function isAppLocationWritable(): boolean {
  try {
    accessSync(dirname(getAppBundlePath()), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// MacCustomUpdater
// ---------------------------------------------------------------------------

/**
 * Custom macOS updater that bypasses Squirrel.Mac's code signature
 * verification. Downloads the ZIP from GitHub releases, verifies SHA-512,
 * extracts, and replaces the .app bundle via a detached shell script.
 *
 * Features beyond the basic electron-updater flow:
 * - Persists pending update state so downloads survive app restarts
 * - Auto-installs on quit (like electron-updater's autoInstallOnAppQuit)
 * - Retries failed downloads with exponential backoff
 * - Backs up old .app before replacing (recoverable on failure)
 * - Skips updates when running from a read-only location (e.g. DMG)
 */
export class MacCustomUpdater {
  private window: BrowserWindow;
  private pendingUpdate: PendingUpdate | null = null;
  private downloading = false;
  private installing = false;

  constructor(window: BrowserWindow) {
    this.window = window;
    this.restorePendingUpdate();
  }

  /**
   * Register a before-quit handler that silently replaces the .app
   * when the user quits normally and an update is pending.
   * Unlike explicit quitAndInstall, this does NOT relaunch the app.
   */
  registerAutoInstallOnQuit(): void {
    app.on("before-quit", () => {
      if (this.pendingUpdate && !this.installing) {
        this.installing = true;
        this.runInstallScript(false);
      }
    });
  }

  async checkForUpdates(): Promise<void> {
    if (this.downloading) return;

    // If a pending update was restored from disk, notify the frontend
    if (this.pendingUpdate) {
      sendToWindow(this.window, "updater:update-downloaded", {
        version: this.pendingUpdate.version,
        releaseNotes: this.pendingUpdate.releaseNotes,
        releaseDate: this.pendingUpdate.releaseDate,
      });
      return;
    }

    // Skip updates when the .app is on a read-only volume (e.g. mounted DMG)
    if (!isAppLocationWritable()) return;

    try {
      const ymlUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/latest-mac.yml`;
      const yml = await fetchText(ymlUrl);
      const release = parseLatestYml(yml);

      if (!release.version) return;
      if (!isNewerVersion(release.version, app.getVersion())) return;

      // Fetch release notes from GitHub API (optional, best-effort)
      let releaseNotes = "";
      try {
        const ua = `TermCanvas/${app.getVersion()}`;
        const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/v${release.version}`;
        const json = await fetchText(apiUrl, ua);
        const data = JSON.parse(json) as { body?: string };
        releaseNotes = data.body ?? "";
      } catch {
        // Non-critical — proceed without release notes
      }

      sendToWindow(this.window, "updater:update-available", {
        version: release.version,
        releaseNotes,
        releaseDate: release.releaseDate,
      });

      await this.downloadUpdate(release, releaseNotes);
    } catch (error) {
      sendToWindow(this.window, "updater:error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Explicitly install the pending update and relaunch. */
  quitAndInstall(): void {
    if (!this.pendingUpdate) return;
    this.installing = true;
    this.runInstallScript(true);
    app.quit();
  }

  private async downloadUpdate(
    release: ReleaseInfo,
    releaseNotes: string,
  ): Promise<void> {
    this.downloading = true;
    try {
      // Pick the ZIP matching the current architecture
      const isArm64 = process.arch === "arm64";
      const zipFile = release.files.find(
        (f) =>
          f.url.endsWith(".zip") &&
          (isArm64 ? f.url.includes("arm64") : !f.url.includes("arm64")),
      );

      if (!zipFile) {
        throw new Error("No matching ZIP found for this architecture");
      }

      const downloadUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${release.version}/${zipFile.url}`;
      const stagingDir = getStagingDir();
      const zipPath = join(stagingDir, zipFile.url);

      // Clean and recreate staging directory
      if (existsSync(stagingDir)) {
        rmSync(stagingDir, { recursive: true, force: true });
      }
      mkdirSync(stagingDir, { recursive: true });

      // Download with retry
      await downloadWithRetry(
        downloadUrl,
        zipPath,
        zipFile.size,
        (percent) => {
          sendToWindow(this.window, "updater:download-progress", { percent });
        },
      );

      // Verify SHA-512
      const hash = await computeSha512(zipPath);
      if (hash !== zipFile.sha512) {
        rmSync(stagingDir, { recursive: true, force: true });
        throw new Error("SHA-512 verification failed — update is corrupted");
      }

      // Extract
      const extractDir = join(stagingDir, "extracted");
      await extractZip(zipPath, extractDir);

      // Locate the .app bundle inside the extracted directory
      const appName = readdirSync(extractDir).find((f) => f.endsWith(".app"));
      if (!appName) {
        throw new Error("No .app bundle found in update package");
      }

      // Remove ZIP to save disk space
      rmSync(zipPath, { force: true });

      this.pendingUpdate = {
        version: release.version,
        appPath: join(extractDir, appName),
        releaseNotes,
        releaseDate: release.releaseDate,
      };

      this.savePendingState();

      sendToWindow(this.window, "updater:update-downloaded", {
        version: release.version,
        releaseNotes,
        releaseDate: release.releaseDate,
      });
    } catch (error) {
      sendToWindow(this.window, "updater:error", {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.downloading = false;
    }
  }

  /**
   * Spawn a detached shell script that waits for the app to exit,
   * then replaces the .app bundle.
   *
   * @param relaunch Whether to reopen the app after replacement.
   *   true  → explicit "Restart & Update" flow
   *   false → silent auto-install on quit (don't relaunch)
   */
  private runInstallScript(relaunch: boolean): void {
    if (!this.pendingUpdate) return;

    const currentAppPath = getAppBundlePath();
    const { appPath: newAppPath } = this.pendingUpdate;
    const stagingDir = getStagingDir();
    const pid = process.pid;

    const lines = [
      "#!/bin/bash",
      "",
      "# Wait for the app to exit (with timeout)",
      `ELAPSED=0`,
      `while kill -0 ${pid} 2>/dev/null; do`,
      `  sleep 0.5`,
      `  ELAPSED=$((ELAPSED + 1))`,
      `  if [ $ELAPSED -ge ${INSTALL_WAIT_TIMEOUT_S * 2} ]; then exit 1; fi`,
      `done`,
      "",
      "# Backup old app so we can recover on failure",
      `mv "${currentAppPath}" "${currentAppPath}.backup" || exit 1`,
      "",
      "# Install new app",
      `if mv "${newAppPath}" "${currentAppPath}"; then`,
      `  xattr -cr "${currentAppPath}" 2>/dev/null`,
      `  rm -rf "${currentAppPath}.backup"`,
      `  rm -rf "${stagingDir}"`,
    ];

    if (relaunch) {
      lines.push(`  open "${currentAppPath}"`);
    }

    lines.push(
      `else`,
      `  # Restore backup on failure`,
      `  mv "${currentAppPath}.backup" "${currentAppPath}" 2>/dev/null`,
      `  exit 1`,
      `fi`,
    );

    const script = lines.join("\n");
    const scriptPath = join(stagingDir, "install.sh");
    writeFileSync(scriptPath, script, { mode: 0o755 });

    const child = spawn("bash", [scriptPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  /** Persist pending update state so downloads survive app restarts. */
  private savePendingState(): void {
    if (!this.pendingUpdate) return;
    const state: UpdateState = {
      ...this.pendingUpdate,
      downloadedAt: new Date().toISOString(),
    };
    writeFileSync(getStatePath(), JSON.stringify(state));
  }

  /**
   * Restore a pending update from a previous session.
   * Validates that the extracted .app still exists and the version is
   * still newer than current before accepting.
   */
  private restorePendingUpdate(): void {
    const statePath = getStatePath();
    if (!existsSync(statePath)) return;

    try {
      const raw = readFileSync(statePath, "utf-8");
      const state = JSON.parse(raw) as UpdateState;

      if (!existsSync(state.appPath)) {
        this.cleanStagingDir();
        return;
      }

      if (!isNewerVersion(state.version, app.getVersion())) {
        this.cleanStagingDir();
        return;
      }

      this.pendingUpdate = {
        version: state.version,
        appPath: state.appPath,
        releaseNotes: state.releaseNotes,
        releaseDate: state.releaseDate,
      };
    } catch {
      this.cleanStagingDir();
    }
  }

  /** Remove leftover staging directory. */
  private cleanStagingDir(): void {
    const dir = getStagingDir();
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
