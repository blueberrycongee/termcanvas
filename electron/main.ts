import { app, BrowserWindow, ipcMain, dialog, nativeImage } from "electron";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { PtyManager } from "./pty-manager";
import { ProjectScanner } from "./project-scanner";
import { StatePersistence, TERMCANVAS_DIR } from "./state-persistence";
import { GitFileWatcher } from "./git-watcher";
import { SessionWatcher, type SessionType } from "./session-watcher";
import { ApiServer } from "./api-server";
import { sendToWindow } from "./window-events";
import { detectCli } from "./process-detector";
import { ensureCliLauncher } from "./cli-launchers";
import {
  ensureHydraSkillLinks,
  getHydraSkillSourceDir,
  installHydraSkillLinks,
  uninstallHydraSkillLinks,
} from "./hydra-skill";
import {
  createDefaultComposerSubmitDeps,
  submitComposerRequest,
} from "./composer-submit";
import { collectUsage } from "./usage-collector";
import type { ComposerSubmitRequest } from "../src/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error(
    "[TermCanvas] Another instance is already running. Quitting.\n" +
    "  Kill the old process first: pkill -f Electron",
  );
  app.quit();
}

const PORT_FILE = path.join(TERMCANVAS_DIR, "port");

function writePortFile(port: number) {
  fs.writeFileSync(PORT_FILE, String(port), "utf-8");
}

function cleanupPortFile() {
  try {
    fs.unlinkSync(PORT_FILE);
  } catch {}
}

let mainWindow: BrowserWindow | null = null;
let forceClose = false;
const ptyManager = new PtyManager();
const projectScanner = new ProjectScanner();
const statePersistence = new StatePersistence();
const gitWatcher = new GitFileWatcher();
const sessionWatcher = new SessionWatcher();
const apiServer = new ApiServer({
  getWindow: () => mainWindow,
  ptyManager,
  projectScanner,
});

function createWindow() {
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: "#101010",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    // macOS: hidden title bar with inset traffic lights
    ...(isMac && {
      titleBarStyle: "hiddenInset" as const,
      trafficLightPosition: { x: 12, y: 16 },
    }),
    // Windows: hidden title bar with native window controls overlay
    ...(isWin && {
      titleBarStyle: "hidden" as const,
      titleBarOverlay: {
        color: "#00000000",
        symbolColor: "#888888",
        height: 44,
      },
    }),
    // Linux: hidden title bar (no native overlay, app handles everything)
    ...(!isMac &&
      !isWin && {
        titleBarStyle: "hidden" as const,
      }),
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererReady = false;
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  let rendererReady = false;
  // Intercept close to ask user about saving (only after page loads)
  mainWindow.webContents.on("did-finish-load", async () => {
    rendererReady = true;
    try {
      const port = await apiServer.start();
      writePortFile(port);
      console.log(`[TermCanvas API] http://127.0.0.1:${port}`);
    } catch (err) {
      console.error("[TermCanvas API] Failed to start:", err);
    }
  });
  mainWindow.on("close", (e) => {
    if (forceClose || !mainWindow || !rendererReady) return;
    e.preventDefault();
    sendToWindow(mainWindow, "app:before-close");
  });
}

function setupIpc() {
  // Terminal IPC
  ipcMain.handle(
    "terminal:create",
    async (_event, options: { cwd: string; shell?: string; args?: string[] }) => {
      const ptyId = await ptyManager.create({
        ...options,
        extraPathEntries: [getCliDir()],
      });
      ptyManager.onData(ptyId, (data: string) => {
        ptyManager.captureOutput(ptyId, data);
        sendToWindow(mainWindow, "terminal:output", ptyId, data);
      });
      ptyManager.onExit(ptyId, (exitCode: number) => {
        sendToWindow(mainWindow, "terminal:exit", ptyId, exitCode);
      });
      return ptyId;
    },
  );

  ipcMain.on("terminal:input", (_event, ptyId: number, data: string) => {
    ptyManager.write(ptyId, data);
  });

  ipcMain.on(
    "terminal:resize",
    (_event, ptyId: number, cols: number, rows: number) => {
      ptyManager.resize(ptyId, cols, rows);
    },
  );

  ipcMain.handle("terminal:destroy", (_event, ptyId: number) => {
    ptyManager.destroy(ptyId);
  });

  ipcMain.handle("terminal:get-pid", (_event, ptyId: number) => {
    return ptyManager.getPid(ptyId) ?? null;
  });

  ipcMain.handle("terminal:detect-cli", async (_event, ptyId: number) => {
    const shellPid = ptyManager.getPid(ptyId);
    if (!shellPid) return null;
    return detectCli(shellPid);
  });

  // Session ID discovery for codex/claude
  ipcMain.handle("session:get-codex-latest", () => {
    try {
      const indexPath = path.join(
        os.homedir(),
        ".codex",
        "session_index.jsonl",
      );
      if (!fs.existsSync(indexPath)) return null;
      const lines = fs.readFileSync(indexPath, "utf-8").trim().split("\n");
      const last = lines[lines.length - 1];
      if (!last) return null;
      const entry = JSON.parse(last);
      return entry.id as string;
    } catch {
      return null;
    }
  });

  ipcMain.handle("session:get-claude-by-pid", (_event, pid: number) => {
    try {
      const sessionFile = path.join(
        os.homedir(),
        ".claude",
        "sessions",
        `${pid}.json`,
      );
      if (!fs.existsSync(sessionFile)) return null;
      const data = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
      return data.sessionId as string;
    } catch {
      return null;
    }
  });

  ipcMain.handle("session:get-kimi-latest", (_event, cwd: string) => {
    try {
      // Kimi stores sessions under ~/.kimi/sessions/{cwd_hash}/{session_uuid}/
      const sessionsDir = path.join(os.homedir(), ".kimi", "sessions");
      if (!fs.existsSync(sessionsDir)) return null;
      // Find the project hash dir by checking which contains sessions for this cwd
      const hashDirs = fs.readdirSync(sessionsDir);
      for (const hashDir of hashDirs.reverse()) {
        const fullPath = path.join(sessionsDir, hashDir);
        const uuids = fs.readdirSync(fullPath);
        if (uuids.length > 0) {
          return uuids[uuids.length - 1]; // Latest session UUID
        }
      }
      return null;
    } catch {
      return null;
    }
  });

  // Project IPC
  ipcMain.handle("project:select-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("project:scan", (_event, dirPath: string) => {
    return projectScanner.scan(dirPath);
  });

  ipcMain.handle("project:diff", (_event, worktreePath: string) => {
    try {
      const imageExts = new Set([
        ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico",
      ]);
      const mimeMap: Record<string, string> = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
        ".bmp": "image/bmp", ".ico": "image/x-icon",
      };

      const buildFileInfo = (
        name: string, add: string, del: string,
      ): { name: string; additions: number; deletions: number; binary: boolean; isImage: boolean; imageOld: string | null; imageNew: string | null } => {
        const binary = add === "-";
        const ext = path.extname(name).toLowerCase();
        const isImage = binary && imageExts.has(ext);
        let imageOld: string | null = null;
        let imageNew: string | null = null;

        if (isImage) {
          const mime = mimeMap[ext] ?? "image/png";
          try {
            const oldBuf = execSync(`git show HEAD:${name}`, {
              cwd: worktreePath, encoding: "buffer", maxBuffer: 5 * 1024 * 1024,
            }) as unknown as Buffer;
            imageOld = `data:${mime};base64,${oldBuf.toString("base64")}`;
          } catch { /* new file */ }
          try {
            const filePath = path.join(worktreePath, name);
            if (fs.existsSync(filePath)) {
              const newBuf = fs.readFileSync(filePath);
              imageNew = `data:${mime};base64,${newBuf.toString("base64")}`;
            }
          } catch { /* deleted */ }
        }

        return {
          name,
          additions: binary ? 0 : parseInt(add, 10),
          deletions: binary ? 0 : parseInt(del, 10),
          binary, isImage, imageOld, imageNew,
        };
      };

      // Tracked changes (staged + unstaged) vs last commit
      const diff = execSync("git diff HEAD", {
        cwd: worktreePath, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024,
      });
      const numstat = execSync("git diff HEAD --numstat", {
        cwd: worktreePath, encoding: "utf-8",
      });
      const files = numstat.trim().split("\n").filter(Boolean)
        .map((line: string) => {
          const [add, del, name] = line.split("\t");
          return buildFileInfo(name, add, del);
        });

      // Untracked files
      const untrackedRaw = execSync(
        "git ls-files --others --exclude-standard", {
          cwd: worktreePath, encoding: "utf-8",
        },
      );
      const untrackedNames = untrackedRaw.trim().split("\n").filter(Boolean);

      let untrackedDiff = "";
      for (const name of untrackedNames) {
        const filePath = path.join(worktreePath, name);
        const ext = path.extname(name).toLowerCase();
        const isImage = imageExts.has(ext);
        let isBinary = isImage;

        if (!isBinary) {
          // Quick binary check: look for null bytes in first 8KB
          try {
            const fd = fs.openSync(filePath, "r");
            const buf = Buffer.alloc(8192);
            const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
            fs.closeSync(fd);
            isBinary = buf.subarray(0, bytesRead).includes(0);
          } catch { isBinary = false; }
        }

        if (isBinary) {
          const mime = mimeMap[ext] ?? "application/octet-stream";
          let imageNew: string | null = null;
          if (isImage) {
            try {
              const newBuf = fs.readFileSync(filePath);
              imageNew = `data:${mime};base64,${newBuf.toString("base64")}`;
            } catch { /* skip */ }
          }
          files.push({
            name, additions: 0, deletions: 0,
            binary: true, isImage, imageOld: null, imageNew,
          });
          untrackedDiff += `diff --git a/${name} b/${name}\nnew file\nBinary file\n`;
        } else {
          try {
            const content = fs.readFileSync(filePath, "utf-8");
            const lines = content.split("\n");
            // Remove trailing empty line from final newline
            if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
            const lineCount = lines.length;
            const addLines = lines.map((l) => `+${l}`).join("\n");
            files.push(buildFileInfo(name, String(lineCount), "0"));
            untrackedDiff += `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,${lineCount} @@\n${addLines}\n`;
          } catch { /* skip unreadable */ }
        }
      }

      return { diff: diff + untrackedDiff, files };
    } catch {
      return { diff: "", files: [] };
    }
  });

  ipcMain.handle("project:rescan-worktrees", (_event, dirPath: string) => {
    return projectScanner.listWorktrees(dirPath);
  });

  // Git file watcher IPC (Layer 1 of DiffCard refresh)
  ipcMain.handle("git:watch", (_event, worktreePath: string) => {
    gitWatcher.watch(worktreePath, () => {
      sendToWindow(mainWindow, "git:changed", worktreePath);
    });
  });

  ipcMain.handle("git:unwatch", (_event, worktreePath: string) => {
    gitWatcher.unwatch(worktreePath);
  });

  // Session turn-completion watcher IPC
  ipcMain.handle(
    "session:watch",
    (_event, type: SessionType, sessionId: string, cwd: string) => {
      sessionWatcher.watch(sessionId, type, cwd, () => {
        sendToWindow(mainWindow, "session:turn-complete", sessionId);
      });
    },
  );

  ipcMain.handle("session:unwatch", (_event, sessionId: string) => {
    sessionWatcher.unwatch(sessionId);
  });

  // State IPC
  ipcMain.handle("state:load", () => {
    return statePersistence.load();
  });

  ipcMain.handle("state:save", (_event, state: unknown) => {
    statePersistence.save(state);
  });

  // Workspace file IPC
  ipcMain.handle("workspace:save", async (_event, data: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Save Workspace",
      defaultPath: "workspace.termcanvas",
      filters: [{ name: "TermCanvas Workspace", extensions: ["termcanvas"] }],
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, data, "utf-8");
    return true;
  });

  ipcMain.handle("workspace:open", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Open Workspace",
      filters: [{ name: "TermCanvas Workspace", extensions: ["termcanvas"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return fs.readFileSync(result.filePaths[0], "utf-8");
  });

  // Filesystem IPC
  const HIDDEN_DIRS = new Set(["node_modules", ".git", "dist", "build", "out"]);
  const IMAGE_EXTS_FS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
  const MIME_MAP_FS: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  };
  const MAX_FILE_SIZE = 512 * 1024;

  ipcMain.handle("fs:list-dir", (_event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const filtered = entries
        .filter((e) => !e.name.startsWith(".") && !HIDDEN_DIRS.has(e.name))
        .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return filtered;
    } catch {
      return [];
    }
  });

  ipcMain.handle("fs:read-file", (_event, filePath: string) => {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
        return { error: "too-large", size: `${sizeMB} MB` };
      }

      const ext = path.extname(filePath).toLowerCase();
      if (IMAGE_EXTS_FS.has(ext)) {
        const buf = fs.readFileSync(filePath);
        const mime = MIME_MAP_FS[ext] ?? "image/png";
        return { type: "image", content: `data:${mime};base64,${buf.toString("base64")}` };
      }

      // Binary detection: check first 8KB for null bytes
      const fd = fs.openSync(filePath, "r");
      const probe = Buffer.alloc(8192);
      const bytesRead = fs.readSync(fd, probe, 0, 8192, 0);
      fs.closeSync(fd);
      if (probe.subarray(0, bytesRead).includes(0)) {
        return { type: "binary" };
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const type = ext === ".md" ? "markdown" : "text";
      return { type, content };
    } catch {
      return { error: "read-error" };
    }
  });

  // CLI registration
  ipcMain.handle("cli:is-registered", () => isCliRegistered());
  ipcMain.handle("cli:register", () => registerCli());
  ipcMain.handle("cli:unregister", () => unregisterCli());

  // Composer submission
  ipcMain.handle("composer:submit", async (_event, request: ComposerSubmitRequest) => {
    if (!ptyManager.getPid(request.ptyId)) {
      return {
        ok: false,
        code: "target-not-running",
        stage: "target",
        error: "Target terminal is not running.",
      };
    }

    try {
      const result = await submitComposerRequest(
        request,
        createDefaultComposerSubmitDeps(
          process.platform as "darwin" | "win32" | "linux",
          dataUrlToPngBuffer,
          (ptyId: number, data: string) => {
            ptyManager.write(ptyId, data);
          },
        ),
      );

      if (!result.ok) {
        console.error("[Composer] Submit failed:", {
          terminalId: request.terminalId,
          ptyId: request.ptyId,
          terminalType: request.terminalType,
          stage: result.stage,
          code: result.code,
          detail: result.detail ?? result.error,
          requestId: result.requestId,
        });
      }

      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[Composer] Submit crashed:", {
        terminalId: request.terminalId,
        ptyId: request.ptyId,
        terminalType: request.terminalType,
        detail,
      });
      return {
        ok: false,
        code: "internal-error",
        stage: "submit",
        error: detail,
        detail,
      };
    }
  });

  // Usage statistics
  ipcMain.handle("usage:query", async (_event, dateStr: string) => {
    return await collectUsage(dateStr);
  });

  // Close flow
  ipcMain.on("app:close-confirmed", () => {
    ptyManager.destroyAll();
    gitWatcher.unwatchAll();
    sessionWatcher.unwatchAll();
    forceClose = true;
    if (mainWindow) {
      mainWindow.close();
    }
  });
}

function getCliDir(): string {
  const prodDir = path.join(process.resourcesPath, "cli");
  if (fs.existsSync(prodDir)) return prodDir;
  // dev mode: dist-cli/ relative to dist-electron/
  return path.resolve(__dirname, "..", "dist-cli");
}

function dataUrlToPngBuffer(dataUrl: string): Buffer {
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) {
    throw new Error("Invalid image data.");
  }
  return image.toPNG();
}

const CLI_NAMES = ["termcanvas", "hydra"];

/** Ensure CLI launchers exist for the current platform. */
function ensureCliLinks(): void {
  const cliDir = getCliDir();
  if (!fs.existsSync(cliDir)) return;

  for (const name of CLI_NAMES) {
    const jsFile = path.join(cliDir, `${name}.js`);
    try {
      ensureCliLauncher(jsFile);
    } catch {
      // read-only fs in packaged apps; best-effort only
    }
  }
}

const ZPROFILE_PATH = path.join(os.homedir(), ".zprofile");

function getPathExportLine(): string {
  return `export PATH="$PATH:${getCliDir()}"`;
}

function isCliRegistered(): boolean {
  if (process.platform === "darwin") {
    try {
      const content = fs.readFileSync(ZPROFILE_PATH, "utf-8");
      return content.includes(getPathExportLine());
    } catch {
      return false;
    }
  }
  if (process.platform === "linux") {
    const target = path.join(os.homedir(), ".local", "bin", "termcanvas");
    try {
      fs.lstatSync(target);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function registerCli(): boolean {
  const cliDir = getCliDir();
  const cliFiles = ["termcanvas.js", "hydra.js"];

  // Ensure CLI files are executable
  for (const file of cliFiles) {
    try {
      fs.chmodSync(path.join(cliDir, file), 0o755);
    } catch {
      // may fail in asar, non-critical
    }
  }

  let ok = false;

  if (process.platform === "darwin") {
    const line = getPathExportLine();
    try {
      let content = "";
      try {
        content = fs.readFileSync(ZPROFILE_PATH, "utf-8");
      } catch {
        // file doesn't exist yet
      }
      if (content.includes(line)) {
        ok = true;
      } else {
        const newContent = content.endsWith("\n") || content === ""
          ? content + line + "\n"
          : content + "\n" + line + "\n";
        fs.writeFileSync(ZPROFILE_PATH, newContent);
        ok = true;
      }
    } catch {
      return false;
    }
  }

  if (process.platform === "linux") {
    const binDir = "/usr/local/bin";
    const fallbackDir = path.join(os.homedir(), ".local", "bin");
    const clis = ["termcanvas", "hydra"];

    let targetDir = binDir;
    try {
      fs.accessSync(binDir, fs.constants.W_OK);
    } catch {
      targetDir = fallbackDir;
      fs.mkdirSync(targetDir, { recursive: true });
    }

    try {
      for (const name of clis) {
        const target = path.join(targetDir, name);
        const source = path.join(cliDir, `${name}.js`);
        try { fs.unlinkSync(target); } catch { /* doesn't exist */ }
        fs.symlinkSync(source, target);
      }
      ok = true;
    } catch {
      return false;
    }
  }

  // Auto-install hydra skill alongside CLI
  if (ok) installSkill();

  return ok;
}

function unregisterCli(): boolean {
  // Auto-uninstall hydra skill alongside CLI
  uninstallSkill();

  if (process.platform === "darwin") {
    const line = getPathExportLine();
    try {
      const content = fs.readFileSync(ZPROFILE_PATH, "utf-8");
      if (!content.includes(line)) return true;
      const newContent = content
        .split("\n")
        .filter((l) => l !== line)
        .join("\n");
      fs.writeFileSync(ZPROFILE_PATH, newContent);
      return true;
    } catch {
      return false;
    }
  }

  if (process.platform === "linux") {
    const clis = ["termcanvas", "hydra"];
    const dirs = ["/usr/local/bin", path.join(os.homedir(), ".local", "bin")];
    for (const dir of dirs) {
      for (const name of clis) {
        try { fs.unlinkSync(path.join(dir, name)); } catch { /* ok */ }
      }
    }
    return true;
  }

  return false;
}

function getSkillSourceDir(): string {
  return getHydraSkillSourceDir(process.resourcesPath, __dirname);
}

function installSkill(): boolean {
  return installHydraSkillLinks({ sourceDir: getSkillSourceDir() });
}

function ensureSkillInstalled(): boolean {
  return ensureHydraSkillLinks({ sourceDir: getSkillSourceDir() });
}

function uninstallSkill(): boolean {
  return uninstallHydraSkillLinks();
}

app.whenReady().then(() => {
  ensureCliLinks();
  if (isCliRegistered()) ensureSkillInstalled();
  setupIpc();
  createWindow();

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  apiServer.stop();
  cleanupPortFile();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
