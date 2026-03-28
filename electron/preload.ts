import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("termcanvas", {
  terminal: {
    create: (options: { cwd: string; shell?: string; args?: string[]; terminalId?: string; terminalType?: string; theme?: "dark" | "light" }) =>
      ipcRenderer.invoke("terminal:create", options),
    destroy: (ptyId: number) => ipcRenderer.invoke("terminal:destroy", ptyId),
    getPid: (ptyId: number) =>
      ipcRenderer.invoke("terminal:get-pid", ptyId) as Promise<number | null>,
    input: (ptyId: number, data: string) =>
      ipcRenderer.send("terminal:input", ptyId, data),
    resize: (ptyId: number, cols: number, rows: number) =>
      ipcRenderer.send("terminal:resize", ptyId, cols, rows),
    notifyThemeChanged: (ptyId: number) =>
      ipcRenderer.send("terminal:theme-changed", ptyId),
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
    findCodex: (cwd: string, startedAt?: string) =>
      ipcRenderer.invoke("session:find-codex", cwd, startedAt) as Promise<
        { sessionId: string; filePath: string; confidence: "medium" | "weak" } | null
      >,
    findClaude: (cwd: string, startedAt?: string, pid?: number | null) =>
      ipcRenderer.invoke("session:find-claude", cwd, startedAt, pid) as Promise<
        { sessionId: string; filePath: string; confidence: "strong" | "medium" | "weak" } | null
      >,
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
  telemetry: {
    attachSession: (input: {
      terminalId: string;
      provider: "claude" | "codex";
      sessionId: string;
      cwd: string;
      confidence: "strong" | "medium" | "weak";
    }) =>
      ipcRenderer.invoke("telemetry:attach-session", input) as Promise<{
        ok: boolean;
        sessionFile: string | null;
      }>,
    detachSession: (terminalId: string) =>
      ipcRenderer.invoke("telemetry:detach-session", terminalId) as Promise<void>,
    updateTerminal: (input: {
      terminalId: string;
      worktreePath?: string;
      provider?: "claude" | "codex" | "unknown";
      ptyId?: number | null;
      shellPid?: number | null;
    }) =>
      ipcRenderer.invoke("telemetry:update-terminal", input),
    getTerminal: (terminalId: string) =>
      ipcRenderer.invoke("telemetry:get-terminal", terminalId),
    getWorkflow: (workflowId: string, repoPath: string) =>
      ipcRenderer.invoke("telemetry:get-workflow", workflowId, repoPath),
    listEvents: (input: { terminalId: string; limit?: number; cursor?: string }) =>
      ipcRenderer.invoke("telemetry:list-events", input),
  },
  project: {
    selectDirectory: () => ipcRenderer.invoke("project:select-directory"),
    scan: (dirPath: string) => ipcRenderer.invoke("project:scan", dirPath),
    rescanWorktrees: (dirPath: string) =>
      ipcRenderer.invoke("project:rescan-worktrees", dirPath),
    enableHydra: (dirPath: string) =>
      ipcRenderer.invoke("project:enable-hydra", dirPath),
    checkHydra: (dirPath: string) =>
      ipcRenderer.invoke("project:check-hydra", dirPath) as Promise<"missing" | "outdated" | "current">,
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
    branches: (worktreePath: string) =>
      ipcRenderer.invoke("git:branches", worktreePath),
    log: (worktreePath: string, count = 200) =>
      ipcRenderer.invoke("git:log", worktreePath, count),
    isRepo: (dirPath: string) =>
      ipcRenderer.invoke("git:is-repo", dirPath) as Promise<boolean>,
    commitDetail: (worktreePath: string, hash: string) =>
      ipcRenderer.invoke("git:commit-detail", worktreePath, hash),
    checkout: (worktreePath: string, ref: string) =>
      ipcRenderer.invoke("git:checkout", worktreePath, ref),
    init: (worktreePath: string) =>
      ipcRenderer.invoke("git:init", worktreePath),
    status: (worktreePath: string) =>
      ipcRenderer.invoke("git:status", worktreePath) as Promise<
        import("../src/types").GitStatusEntry[]
      >,
    stage: (worktreePath: string, paths: string[]) =>
      ipcRenderer.invoke("git:stage", worktreePath, paths) as Promise<void>,
    unstage: (worktreePath: string, paths: string[]) =>
      ipcRenderer.invoke("git:unstage", worktreePath, paths) as Promise<void>,
    discard: (worktreePath: string, trackedPaths: string[], untrackedPaths: string[]) =>
      ipcRenderer.invoke("git:discard", worktreePath, trackedPaths, untrackedPaths) as Promise<void>,
    commit: (worktreePath: string, message: string) =>
      ipcRenderer.invoke("git:commit", worktreePath, message) as Promise<string>,
    push: (worktreePath: string) =>
      ipcRenderer.invoke("git:push", worktreePath) as Promise<string>,
    pull: (worktreePath: string) =>
      ipcRenderer.invoke("git:pull", worktreePath) as Promise<string>,
    onChanged: (callback: (worktreePath: string) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        worktreePath: string,
      ) => callback(worktreePath);
      ipcRenderer.on("git:changed", listener);
      return () => ipcRenderer.removeListener("git:changed", listener);
    },
    onLogChanged: (callback: (worktreePath: string) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        worktreePath: string,
      ) => callback(worktreePath);
      ipcRenderer.on("git:log-changed", listener);
      return () => ipcRenderer.removeListener("git:log-changed", listener);
    },
    onPresenceChanged: (
      callback: (worktreePath: string, payload: { isGitRepo: boolean }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        worktreePath: string,
        payload: { isGitRepo: boolean },
      ) => callback(worktreePath, payload);
      ipcRenderer.on("git:presence-changed", listener);
      return () => ipcRenderer.removeListener("git:presence-changed", listener);
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
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke("fs:write-file", filePath, content) as Promise<
        { changed: boolean }
      >,
    copy: (sources: string[], destDir: string) =>
      ipcRenderer.invoke("fs:copy", sources, destDir) as Promise<
        { copied: string[]; skipped: string[] }
      >,
    getFilePath: (file: File) => webUtils.getPathForFile(file),
    rename: (oldPath: string, newName: string) =>
      ipcRenderer.invoke("fs:rename", oldPath, newName) as Promise<void>,
    delete: (targetPath: string) =>
      ipcRenderer.invoke("fs:delete", targetPath) as Promise<void>,
    mkdir: (dirPath: string, name: string) =>
      ipcRenderer.invoke("fs:mkdir", dirPath, name) as Promise<void>,
    createFile: (dirPath: string, name: string) =>
      ipcRenderer.invoke("fs:create-file", dirPath, name) as Promise<void>,
    reveal: (targetPath: string) =>
      ipcRenderer.invoke("fs:reveal", targetPath) as Promise<void>,
  },
  memory: {
    scan: (worktreePath: string) =>
      ipcRenderer.invoke("memory:scan", worktreePath),
    watch: (worktreePath: string) =>
      ipcRenderer.invoke("memory:watch", worktreePath),
    unwatch: (worktreePath: string) =>
      ipcRenderer.invoke("memory:unwatch", worktreePath),
    onChanged: (callback: (graph: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, graph: unknown) =>
        callback(graph);
      ipcRenderer.on("memory:changed", listener);
      return () => ipcRenderer.removeListener("memory:changed", listener);
    },
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
  codexQuota: {
    fetch: () => ipcRenderer.invoke("codex-quota:fetch"),
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
    requestClose: () => ipcRenderer.send("app:request-close"),
    confirmClose: (options?: { installUpdate?: boolean }) =>
      ipcRenderer.send("app:close-confirmed", options),
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
  menu: {
    onOpenFolder: (callback: (dirPath: string) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, dirPath: string) => callback(dirPath);
      ipcRenderer.on("menu:open-folder", listener);
      return () => ipcRenderer.removeListener("menu:open-folder", listener);
    },
  },
});
