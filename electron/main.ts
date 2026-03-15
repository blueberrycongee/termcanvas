import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { PtyManager } from "./pty-manager";
import { ProjectScanner } from "./project-scanner";
import { StatePersistence } from "./state-persistence";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let forceClose = false;
const ptyManager = new PtyManager();
const projectScanner = new ProjectScanner();
const statePersistence = new StatePersistence();

function createWindow() {
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
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

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Intercept close to ask user about saving (only after page loads)
  let rendererReady = false;
  mainWindow.webContents.on("did-finish-load", () => {
    rendererReady = true;
  });
  mainWindow.on("close", (e) => {
    if (forceClose || !mainWindow || !rendererReady) return;
    e.preventDefault();
    mainWindow.webContents.send("app:before-close");
  });
}

function setupIpc() {
  // Terminal IPC
  ipcMain.handle(
    "terminal:create",
    (_event, options: { cwd: string; shell?: string; args?: string[] }) => {
      const ptyId = ptyManager.create(options);
      ptyManager.onData(ptyId, (data: string) => {
        mainWindow?.webContents.send("terminal:output", ptyId, data);
      });
      ptyManager.onExit(ptyId, (exitCode: number) => {
        mainWindow?.webContents.send("terminal:exit", ptyId, exitCode);
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
      const { execSync } = require("child_process");
      const diff = execSync("git diff", {
        cwd: worktreePath,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
      // numstat: additions  deletions  filename per line
      const numstat = execSync("git diff --numstat", {
        cwd: worktreePath,
        encoding: "utf-8",
      });
      const imageExts = new Set([
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".svg",
        ".webp",
        ".bmp",
        ".ico",
      ]);
      const files = numstat
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line: string) => {
          const [add, del, name] = line.split("\t");
          const binary = add === "-";
          const ext = path.extname(name).toLowerCase();
          const isImage = binary && imageExts.has(ext);

          let imageOld: string | null = null;
          let imageNew: string | null = null;

          if (isImage) {
            const mimeMap: Record<string, string> = {
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".gif": "image/gif",
              ".svg": "image/svg+xml",
              ".webp": "image/webp",
              ".bmp": "image/bmp",
              ".ico": "image/x-icon",
            };
            const mime = mimeMap[ext] ?? "image/png";

            // Try reading old version from HEAD
            try {
              const oldBuf = execSync(`git show HEAD:${name}`, {
                cwd: worktreePath,
                encoding: "buffer",
                maxBuffer: 5 * 1024 * 1024,
              }) as unknown as Buffer;
              imageOld = `data:${mime};base64,${oldBuf.toString("base64")}`;
            } catch {
              // File is new (not in HEAD)
            }

            // Try reading current version from working tree
            try {
              const filePath = path.join(worktreePath, name);
              if (fs.existsSync(filePath)) {
                const newBuf = fs.readFileSync(filePath);
                imageNew = `data:${mime};base64,${newBuf.toString("base64")}`;
              }
            } catch {
              // File was deleted
            }
          }

          return {
            name,
            additions: binary ? 0 : parseInt(add, 10),
            deletions: binary ? 0 : parseInt(del, 10),
            binary,
            isImage,
            imageOld,
            imageNew,
          };
        });
      return { diff, files };
    } catch {
      return { diff: "", files: [] };
    }
  });

  ipcMain.handle("project:rescan-worktrees", (_event, dirPath: string) => {
    return projectScanner.listWorktrees(dirPath);
  });

  ipcMain.on("project:watch", (_event, dirPath: string) => {
    projectScanner.startWatching(dirPath, (worktrees) => {
      mainWindow?.webContents.send(
        "project:worktrees-changed",
        dirPath,
        worktrees,
      );
    });
  });

  ipcMain.on("project:unwatch", (_event, dirPath: string) => {
    projectScanner.stopWatching(dirPath);
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

  // Close flow
  ipcMain.on("app:close-confirmed", () => {
    ptyManager.destroyAll();
    projectScanner.stopAllWatching();
    forceClose = true;
    if (mainWindow) {
      mainWindow.close();
    }
  });
}

app.whenReady().then(() => {
  setupIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
