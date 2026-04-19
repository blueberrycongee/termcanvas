import { app, net } from "electron";
import {
  createWriteStream,
  mkdirSync,
  rmSync,
  renameSync,
  readdirSync,
  existsSync,
  createReadStream,
  writeFileSync,
  readFileSync,
  copyFileSync,
  openSync,
  closeSync,
  accessSync,
  constants,
} from "fs";
import { join, resolve, dirname } from "path";
import { createHash } from "crypto";
import { gunzipSync } from "zlib";
import { spawn, execFile } from "child_process";
import type { BrowserWindow } from "electron";
import { sendToWindow } from "./window-events";

const GITHUB_OWNER = "blueberrycongee";
const GITHUB_REPO = "termcanvas";
const MAX_DOWNLOAD_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2000;
const INSTALL_WAIT_TIMEOUT_S = 30;
const RANGE_REQUEST_COOLDOWN_INTERVAL = 100;
const RANGE_REQUEST_COOLDOWN_MS = 1000;

interface ReleaseFile {
  url: string;
  sha512: string;
  size: number;
}

// ── Blockmap types (matches builder-util-runtime/blockMapApi) ──

interface BlockMapFile {
  name: string;
  offset: number;
  checksums: string[];
  sizes: number[];
}

interface BlockMap {
  version: "1" | "2";
  files: BlockMapFile[];
}

const enum OperationKind {
  COPY = 0,
  DOWNLOAD = 1,
}

interface Operation {
  kind: OperationKind;
  start: number;
  end: number;
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

function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

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

function computeSha512(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("base64")));
    stream.on("error", reject);
  });
}

function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(destDir, { recursive: true });
    execFile("ditto", ["-xk", zipPath, destDir], (err) => {
      if (err) reject(new Error(`Failed to extract update: ${err.message}`));
      else resolve();
    });
  });
}

// ── Blockmap differential download helpers ──

function getCacheDir(): string {
  return join(app.getPath("userData"), "update-cache");
}

function getCachedZipPath(): string {
  return join(getCacheDir(), "update.zip");
}

function getCachedBlockMapPath(): string {
  return join(getCacheDir(), "current.blockmap");
}

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    const chunks: Buffer[] = [];
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} from ${url}`));
        return;
      }
      response.on("data", (chunk) => chunks.push(chunk as Buffer));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchBlockMap(url: string): Promise<BlockMap> {
  const data = await fetchBuffer(url);
  if (data.length === 0) throw new Error(`Empty blockmap from ${url}`);
  return JSON.parse(gunzipSync(data).toString()) as BlockMap;
}

/**
 * Download a byte range from a URL. Handles GitHub's 302 redirect to S3.
 * Returns the resolved CDN URL so callers can skip redirects on subsequent requests.
 */
function downloadRange(
  url: string,
  start: number,
  end: number,
): Promise<{ data: Buffer; resolvedUrl: string }> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: "manual" });
    request.setHeader("Range", `bytes=${start}-${end - 1}`);

    let resolvedUrl = url;

    request.on("redirect", (_status, _method, redirectUrl) => {
      resolvedUrl = redirectUrl;
      request.followRedirect();
    });

    request.on("response", (response) => {
      if (response.statusCode >= 400) {
        reject(new Error(`HTTP ${response.statusCode} on range request`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk as Buffer));
      response.on("end", () =>
        resolve({ data: Buffer.concat(chunks), resolvedUrl }),
      );
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

/**
 * Port of electron-updater's downloadPlanBuilder.computeOperations.
 * Compares old and new blockmaps block-by-block, returning a list of
 * COPY (reuse from old file) and DOWNLOAD (fetch from new file) operations.
 */
function computeOperations(
  oldBlockMap: BlockMap,
  newBlockMap: BlockMap,
): Operation[] {
  if (oldBlockMap.version !== newBlockMap.version) {
    throw new Error(
      `Blockmap version mismatch (${oldBlockMap.version} vs ${newBlockMap.version})`,
    );
  }

  const newFile = newBlockMap.files[0];
  const oldFile = oldBlockMap.files.find((f) => f.name === newFile.name);
  if (!oldFile) throw new Error(`No file "${newFile.name}" in old blockmap`);

  // Build checksum → offset/size maps for old file
  const checksumToOldOffset = new Map<string, number>();
  const checksumToOldSize = new Map<string, number>();
  let offset = oldFile.offset;
  for (let i = 0; i < oldFile.checksums.length; i++) {
    const cs = oldFile.checksums[i];
    if (!checksumToOldOffset.has(cs)) {
      checksumToOldOffset.set(cs, offset);
      checksumToOldSize.set(cs, oldFile.sizes[i]);
    }
    offset += oldFile.sizes[i];
  }

  // Walk new file blocks, decide COPY or DOWNLOAD
  const operations: Operation[] = [];
  let last: Operation | null = null;
  let newOffset = newFile.offset;

  for (let i = 0; i < newFile.checksums.length; i++) {
    const blockSize = newFile.sizes[i];
    const checksum = newFile.checksums[i];
    let oldOff = checksumToOldOffset.get(checksum);

    // Checksum match but size mismatch → treat as changed
    if (oldOff != null && checksumToOldSize.get(checksum) !== blockSize) {
      oldOff = undefined;
    }

    if (oldOff === undefined) {
      // DOWNLOAD from new file
      if (last?.kind === OperationKind.DOWNLOAD && last.end === newOffset) {
        last.end += blockSize;
      } else {
        last = { kind: OperationKind.DOWNLOAD, start: newOffset, end: newOffset + blockSize };
        operations.push(last);
      }
    } else {
      // COPY from old file
      if (last?.kind === OperationKind.COPY && last.end === oldOff) {
        last.end += blockSize;
      } else {
        last = { kind: OperationKind.COPY, start: oldOff, end: oldOff + blockSize };
        operations.push(last);
      }
    }

    newOffset += blockSize;
  }

  return operations;
}

/**
 * Reconstruct a new ZIP by copying unchanged blocks from the old ZIP
 * and downloading only changed blocks via HTTP Range requests.
 */
async function downloadDifferential(
  oldZipPath: string,
  oldBlockMap: BlockMap,
  newBlockMap: BlockMap,
  newFileUrl: string,
  newFileSize: number,
  onProgress: (percent: number) => void,
  destPath: string,
): Promise<void> {
  const operations = computeOperations(oldBlockMap, newBlockMap);

  let downloadSize = 0;
  let copySize = 0;
  for (const op of operations) {
    const len = op.end - op.start;
    if (op.kind === OperationKind.DOWNLOAD) downloadSize += len;
    else copySize += len;
  }

  if (downloadSize + copySize !== newFileSize) {
    throw new Error(
      `Size mismatch: download=${downloadSize} + copy=${copySize} != expected=${newFileSize}`,
    );
  }

  const oldFd = openSync(oldZipPath, "r");
  const outStream = createWriteStream(destPath);
  let downloaded = 0;
  let resolvedUrl = newFileUrl;
  let rangeCount = 0;

  try {
    for (const op of operations) {
      if (op.kind === OperationKind.COPY) {
        // Read from old ZIP and write to output
        await new Promise<void>((res, rej) => {
          const readStream = createReadStream("", {
            fd: oldFd,
            autoClose: false,
            start: op.start,
            end: op.end - 1,
          });
          readStream.on("error", rej);
          readStream.pipe(outStream, { end: false });
          readStream.once("end", res);
        });
      } else {
        // Download range from remote
        const result = await downloadRange(resolvedUrl, op.start, op.end);
        resolvedUrl = result.resolvedUrl;

        await new Promise<void>((res, rej) => {
          const ok = outStream.write(result.data, (err) => {
            if (err) rej(err);
            else res();
          });
          if (!ok) {
            outStream.once("drain", () => res());
          }
        });

        downloaded += result.data.length;
        onProgress(
          downloadSize > 0
            ? Math.min(100, (downloaded / downloadSize) * 100)
            : 100,
        );

        // Rate limit: pause after every N range requests
        if (++rangeCount % RANGE_REQUEST_COOLDOWN_INTERVAL === 0) {
          await new Promise((r) => setTimeout(r, RANGE_REQUEST_COOLDOWN_MS));
        }
      }
    }

    await new Promise<void>((res, rej) => {
      outStream.end((err: Error | null) => (err ? rej(err) : res()));
    });
  } finally {
    closeSync(oldFd);
  }
}

function getStagingDir(): string {
  return join(app.getPath("userData"), "pending-update");
}

function getStatePath(): string {
  return join(getStagingDir(), "state.json");
}

function getAppBundlePath(): string {
  return resolve(app.getAppPath(), "../../..");
}

function isAppLocationWritable(): boolean {
  try {
    accessSync(dirname(getAppBundlePath()), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

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
  private locationWarningSent = false;

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

    // Skip updates when the .app is on a read-only volume (e.g. mounted DMG)
    // or in a TCC-restricted location like ~/Downloads. Notify the UI once so
    // the user knows why auto-update is silently unavailable.
    if (!isAppLocationWritable()) {
      if (!this.locationWarningSent) {
        this.locationWarningSent = true;
        sendToWindow(this.window, "updater:location-warning", {
          bundlePath: getAppBundlePath(),
        });
      }
      return;
    }

    try {
      const ymlUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/latest-mac.yml`;
      const yml = await fetchText(ymlUrl);
      const release = parseLatestYml(yml);

      if (!release.version) return;
      if (!isNewerVersion(release.version, app.getVersion())) return;

      // If a pending update already matches the latest, just re-notify the UI
      if (
        this.pendingUpdate &&
        this.pendingUpdate.version === release.version
      ) {
        sendToWindow(this.window, "updater:update-downloaded", {
          version: this.pendingUpdate.version,
          releaseNotes: this.pendingUpdate.releaseNotes,
          releaseDate: this.pendingUpdate.releaseDate,
        });
        return;
      }

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
      // If we already have a valid pending update (e.g. offline), surface it
      // instead of showing an error so users can still install it
      if (this.pendingUpdate) {
        sendToWindow(this.window, "updater:update-downloaded", {
          version: this.pendingUpdate.version,
          releaseNotes: this.pendingUpdate.releaseNotes,
          releaseDate: this.pendingUpdate.releaseDate,
        });
        return;
      }
      sendToWindow(this.window, "updater:error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

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
    const tempDir = getStagingDir() + "-tmp";
    try {
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
      const blockmapUrl = `${downloadUrl}.blockmap`;

      // Download into a temp dir so the existing pending update survives
      // if this download fails (network error, hash mismatch, etc.)
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      const zipPath = join(tempDir, zipFile.url);
      let usedDifferential = false;

      // Try differential download if we have a cached ZIP + blockmap
      const cachedZip = getCachedZipPath();
      const cachedBlockMap = getCachedBlockMapPath();
      if (existsSync(cachedZip) && existsSync(cachedBlockMap)) {
        try {
          const oldBlockMap = JSON.parse(
            gunzipSync(readFileSync(cachedBlockMap)).toString(),
          ) as BlockMap;
          const newBlockMapBuf = await fetchBuffer(blockmapUrl);
          const newBlockMap = JSON.parse(
            gunzipSync(newBlockMapBuf).toString(),
          ) as BlockMap;

          await downloadDifferential(
            cachedZip,
            oldBlockMap,
            newBlockMap,
            downloadUrl,
            zipFile.size,
            (percent) => {
              sendToWindow(this.window, "updater:download-progress", {
                percent,
              });
            },
            zipPath,
          );

          usedDifferential = true;
        } catch {
          // Differential failed — fall through to full download
          if (existsSync(zipPath)) rmSync(zipPath, { force: true });
        }
      }

      if (!usedDifferential) {
        await downloadWithRetry(
          downloadUrl,
          zipPath,
          zipFile.size,
          (percent) => {
            sendToWindow(this.window, "updater:download-progress", { percent });
          },
        );
      }

      const hash = await computeSha512(zipPath);
      if (hash !== zipFile.sha512) {
        throw new Error("SHA-512 verification failed — update is corrupted");
      }

      // Cache the verified ZIP + its blockmap for next differential update
      await this.updateCache(zipPath, blockmapUrl);

      const extractDir = join(tempDir, "extracted");
      await extractZip(zipPath, extractDir);

      const appName = readdirSync(extractDir).find((f) => f.endsWith(".app"));
      if (!appName) {
        throw new Error("No .app bundle found in update package");
      }

      rmSync(zipPath, { force: true });

      // Download succeeded — replace the old staging dir atomically
      const stagingDir = getStagingDir();
      if (existsSync(stagingDir)) {
        rmSync(stagingDir, { recursive: true, force: true });
      }
      renameSync(tempDir, stagingDir);

      this.pendingUpdate = {
        version: release.version,
        appPath: join(stagingDir, "extracted", appName),
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
      // Clean up temp dir on failure; existing pending update is untouched
      if (existsSync(tempDir)) {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
      sendToWindow(this.window, "updater:error", {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.downloading = false;
    }
  }

  /**
   * Cache the verified ZIP and its blockmap so the next update can use
   * differential downloads. Runs best-effort — failures don't block the update.
   */
  private async updateCache(
    zipPath: string,
    blockmapUrl: string,
  ): Promise<void> {
    try {
      const cacheDir = getCacheDir();
      mkdirSync(cacheDir, { recursive: true });
      copyFileSync(zipPath, getCachedZipPath());
      const blockmapData = await fetchBuffer(blockmapUrl);
      writeFileSync(getCachedBlockMapPath(), blockmapData);
    } catch {
      // Non-critical — next update will fall back to full download
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
