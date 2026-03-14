import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { PtyManager } from "./pty-manager";
import { ProjectScanner } from "./project-scanner";
import { StatePersistence } from "./state-persistence";

let mainWindow: BrowserWindow | null = null;
const ptyManager = new PtyManager();
const projectScanner = new ProjectScanner();
const statePersistence = new StatePersistence();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function setupIpc() {
  // Terminal IPC
  ipcMain.handle(
    "terminal:create",
    (_event, options: { cwd: string; shell?: string }) => {
      const ptyId = ptyManager.create(options.cwd, options.shell);
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

  // State IPC
  ipcMain.handle("state:load", () => {
    return statePersistence.load();
  });

  ipcMain.handle("state:save", (_event, state: unknown) => {
    statePersistence.save(state);
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
  ptyManager.destroyAll();
  if (process.platform !== "darwin") app.quit();
});
