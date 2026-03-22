import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("termcanvas", {
  terminal: {
    create: (options: { cwd: string; shell?: string; args?: string[]; terminalId?: string }) =>
      ipcRenderer.invoke("terminal:create", options),
    destroy: (ptyId: number) => ipcRenderer.invoke("terminal:destroy", ptyId),
    getPid: (ptyId: number) =>
      ipcRenderer.invoke("terminal:get-pid", ptyId) as Promise<number | null>,
    input: (ptyId: number, data: string) =>
      ipcRenderer.send("terminal:input", ptyId, data),
    resize: (ptyId: number, cols: number, rows: number) =>
      ipcRenderer.send("terminal:resize", ptyId, cols, rows),
    onOutput: (callback: (ptyId: number, data: string) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        ptyId: number,
        data: string,
      ) => callback(ptyId, data);
      ipcRenderer.on("terminal:output", listener);
      return () => ipcRenderer.removeListener("terminal:output", listener);
    },
    onExit: (callback: (ptyId: number, exitCode: number) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        ptyId: number,
        exitCode: number,
      ) => callback(ptyId, exitCode);
      ipcRenderer.on("terminal:exit", listener);
      return () => ipcRenderer.removeListener("terminal:exit", listener);
    },
    detectCli: (ptyId: number) =>
      ipcRenderer.invoke("terminal:detect-cli", ptyId),
  },
  session: {
    getCodexLatest: () =>
      ipcRenderer.invoke("session:get-codex-latest") as Promise<string | null>,
    getClaudeByPid: (pid: number) =>
      ipcRenderer.invoke("session:get-claude-by-pid", pid) as Promise<
        string | null
      >,
    getKimiLatest: (cwd: string) =>
      ipcRenderer.invoke("session:get-kimi-latest", cwd) as Promise<
        string | null
      >,
    watch: (type: string, sessionId: string, cwd: string) =>
      ipcRenderer.invoke("session:watch", type, sessionId, cwd) as Promise<
        { ok: boolean; reason?: string }
      >,
    unwatch: (sessionId: string) =>
      ipcRenderer.invoke("session:unwatch", sessionId),
    onTurnComplete: (callback: (sessionId: string) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        sessionId: string,
      ) => callback(sessionId);
      ipcRenderer.on("session:turn-complete", listener);
      return () =>
        ipcRenderer.removeListener("session:turn-complete", listener);
    },
  },
  project: {
    selectDirectory: () => ipcRenderer.invoke("project:select-directory"),
    scan: (dirPath: string) => ipcRenderer.invoke("project:scan", dirPath),
    rescanWorktrees: (dirPath: string) =>
      ipcRenderer.invoke("project:rescan-worktrees", dirPath),
    diff: (worktreePath: string) =>
      ipcRenderer.invoke("project:diff", worktreePath) as Promise<{
        diff: string;
        files: {
          name: string;
          additions: number;
          deletions: number;
          binary: boolean;
          isImage: boolean;
          imageOld: string | null;
          imageNew: string | null;
        }[];
      }>,
  },
  git: {
    watch: (worktreePath: string) =>
      ipcRenderer.invoke("git:watch", worktreePath),
    unwatch: (worktreePath: string) =>
      ipcRenderer.invoke("git:unwatch", worktreePath),
    onChanged: (callback: (worktreePath: string) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        worktreePath: string,
      ) => callback(worktreePath);
      ipcRenderer.on("git:changed", listener);
      return () => ipcRenderer.removeListener("git:changed", listener);
    },
  },
  state: {
    load: () => ipcRenderer.invoke("state:load"),
    save: (state: unknown) => ipcRenderer.invoke("state:save", state),
  },
  workspace: {
    save: (data: string) =>
      ipcRenderer.invoke("workspace:save", data) as Promise<string | null>,
    open: () => ipcRenderer.invoke("workspace:open") as Promise<string | null>,
    saveToPath: (filePath: string, data: string) =>
      ipcRenderer.invoke("workspace:save-to-path", filePath, data) as Promise<void>,
    setTitle: (title: string) =>
      ipcRenderer.invoke("workspace:set-title", title) as Promise<void>,
  },
  fs: {
    listDir: (dirPath: string) =>
      ipcRenderer.invoke("fs:list-dir", dirPath) as Promise<
        { name: string; isDirectory: boolean }[]
      >,
    readFile: (filePath: string) =>
      ipcRenderer.invoke("fs:read-file", filePath) as Promise<
        | { type: string; content: string }
        | { error: string; size?: string }
      >,
  },
  cli: {
    isRegistered: () =>
      ipcRenderer.invoke("cli:is-registered") as Promise<boolean>,
    register: () =>
      ipcRenderer.invoke("cli:register") as Promise<boolean>,
    unregister: () =>
      ipcRenderer.invoke("cli:unregister") as Promise<boolean>,
    validateCommand: (command: string, args?: string[]) =>
      ipcRenderer.invoke("cli:validate-command", command, args) as Promise<
        | { ok: true; resolvedPath: string; version: string | null }
        | { ok: false; error: string }
      >,
  },
  fonts: {
    getPath: () =>
      ipcRenderer.invoke("font:get-path") as Promise<string>,
    listDownloaded: () =>
      ipcRenderer.invoke("font:list-downloaded") as Promise<string[]>,
    check: (fileName: string) =>
      ipcRenderer.invoke("font:check", fileName) as Promise<boolean>,
    download: (url: string, fileName: string) =>
      ipcRenderer.invoke("font:download", url, fileName) as Promise<{
        ok: boolean;
        path?: string;
        error?: string;
      }>,
  },
  composer: {
    submit: (request: unknown) =>
      ipcRenderer.invoke("composer:submit", request),
  },
  usage: {
    query: (dateStr: string) =>
      ipcRenderer.invoke("usage:query", dateStr),
    heatmap: () =>
      ipcRenderer.invoke("usage:heatmap"),
    queryCloud: (dateStr: string) =>
      ipcRenderer.invoke("usage:query-cloud", dateStr),
    heatmapCloud: () =>
      ipcRenderer.invoke("usage:heatmap-cloud"),
  },
  quota: {
    fetch: () => ipcRenderer.invoke("quota:fetch"),
  },
  insights: {
    generate: (cliTool: "claude" | "codex", jobId: string) =>
      ipcRenderer.invoke("insights:generate", cliTool, jobId) as Promise<
        | { ok: true; jobId: string; reportPath: string }
        | { ok: false; jobId: string; error: { code: string; message: string; detail?: string } }
      >,
    onProgress: (callback: (progress: { jobId: string; stage: string; current: number; total: number; message: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: { jobId: string; stage: string; current: number; total: number; message: string }) =>
        callback(progress);
      ipcRenderer.on("insights:progress", listener);
      return () => ipcRenderer.removeListener("insights:progress", listener);
    },
    openReport: (filePath: string) =>
      ipcRenderer.invoke("insights:open-report", filePath),
    getLastReport: () =>
      ipcRenderer.invoke("insights:get-last-report") as Promise<string | null>,
  },
  auth: {
    login: () => ipcRenderer.invoke("auth:login"),
    logout: () => ipcRenderer.invoke("auth:logout"),
    getUser: () =>
      ipcRenderer.invoke("auth:get-user") as Promise<{
        id: string;
        username: string;
        avatarUrl: string;
        email: string;
      } | null>,
    getDeviceId: () =>
      ipcRenderer.invoke("auth:get-device-id") as Promise<string>,
    onAuthStateChange: (callback: (user: { id: string; username: string; avatarUrl: string; email: string } | null) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, user: { id: string; username: string; avatarUrl: string; email: string } | null) =>
        callback(user);
      ipcRenderer.on("auth:state-changed", listener);
      return () => ipcRenderer.removeListener("auth:state-changed", listener);
    },
  },
  app: {
    platform: process.platform as "darwin" | "win32" | "linux",
    onBeforeClose: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("app:before-close", listener);
      return () => ipcRenderer.removeListener("app:before-close", listener);
    },
    confirmClose: () => ipcRenderer.send("app:close-confirmed"),
  },
  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    install: () => ipcRenderer.send("updater:install"),
    getVersion: () => ipcRenderer.invoke("updater:get-version") as Promise<string>,
    onUpdateAvailable: (callback: (info: { version: string; releaseNotes: string; releaseDate: string }) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, info: { version: string; releaseNotes: string; releaseDate: string }) => callback(info);
      ipcRenderer.on("updater:update-available", listener);
      return () => ipcRenderer.removeListener("updater:update-available", listener);
    },
    onDownloadProgress: (callback: (progress: { percent: number }) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, progress: { percent: number }) => callback(progress);
      ipcRenderer.on("updater:download-progress", listener);
      return () => ipcRenderer.removeListener("updater:download-progress", listener);
    },
    onUpdateDownloaded: (callback: (info: { version: string; releaseNotes: string; releaseDate: string }) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, info: { version: string; releaseNotes: string; releaseDate: string }) => callback(info);
      ipcRenderer.on("updater:update-downloaded", listener);
      return () => ipcRenderer.removeListener("updater:update-downloaded", listener);
    },
    onError: (callback: (error: { message: string }) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, error: { message: string }) => callback(error);
      ipcRenderer.on("updater:error", listener);
      return () => ipcRenderer.removeListener("updater:error", listener);
    },
  },
});
