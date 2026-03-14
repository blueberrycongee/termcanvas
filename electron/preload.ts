import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("termcanvas", {
  terminal: {
    create: (options: { cwd: string; shell?: string }) =>
      ipcRenderer.invoke("terminal:create", options),
    destroy: (ptyId: number) => ipcRenderer.invoke("terminal:destroy", ptyId),
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
  project: {
    selectDirectory: () => ipcRenderer.invoke("project:select-directory"),
    scan: (dirPath: string) => ipcRenderer.invoke("project:scan", dirPath),
  },
  state: {
    load: () => ipcRenderer.invoke("state:load"),
    save: (state: unknown) => ipcRenderer.invoke("state:save", state),
  },
});
