import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("termcanvas", {
  terminal: {
    create: (options: { cwd: string; shell?: string; args?: string[] }) =>
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
  },
  session: {
    getCodexLatest: () =>
      ipcRenderer.invoke("session:get-codex-latest") as Promise<string | null>,
    getClaudeByPid: (pid: number) =>
      ipcRenderer.invoke("session:get-claude-by-pid", pid) as Promise<
        string | null
      >,
  },
  project: {
    selectDirectory: () => ipcRenderer.invoke("project:select-directory"),
    scan: (dirPath: string) => ipcRenderer.invoke("project:scan", dirPath),
    rescanWorktrees: (dirPath: string) =>
      ipcRenderer.invoke("project:rescan-worktrees", dirPath),
    watch: (dirPath: string) => ipcRenderer.send("project:watch", dirPath),
    unwatch: (dirPath: string) => ipcRenderer.send("project:unwatch", dirPath),
    onWorktreesChanged: (
      callback: (
        dirPath: string,
        worktrees: { path: string; branch: string; isMain: boolean }[],
      ) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        dirPath: string,
        worktrees: { path: string; branch: string; isMain: boolean }[],
      ) => callback(dirPath, worktrees);
      ipcRenderer.on("project:worktrees-changed", listener);
      return () =>
        ipcRenderer.removeListener("project:worktrees-changed", listener);
    },
  },
  state: {
    load: () => ipcRenderer.invoke("state:load"),
    save: (state: unknown) => ipcRenderer.invoke("state:save", state),
  },
  workspace: {
    save: (data: string) =>
      ipcRenderer.invoke("workspace:save", data) as Promise<boolean>,
    open: () => ipcRenderer.invoke("workspace:open") as Promise<string | null>,
  },
  app: {
    onBeforeClose: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("app:before-close", listener);
      return () => ipcRenderer.removeListener("app:before-close", listener);
    },
    confirmClose: () => ipcRenderer.send("app:close-confirmed"),
  },
});
