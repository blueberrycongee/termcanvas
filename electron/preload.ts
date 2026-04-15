import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("termcanvas", {
  terminal: {
    create: (options: {
      cwd: string;
      shell?: string;
      args?: string[];
      terminalId?: string;
      terminalType?: string;
      theme?: "dark" | "light";
    }) => ipcRenderer.invoke("terminal:create", options),
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
      ipcRenderer.invoke("session:find-codex", cwd, startedAt) as Promise<{
        sessionId: string;
        filePath: string;
        confidence: "medium" | "weak";
      } | null>,
    findClaude: (cwd: string, startedAt?: string, pid?: number | null) =>
      ipcRenderer.invoke(
        "session:find-claude",
        cwd,
        startedAt,
        pid,
      ) as Promise<{
        sessionId: string;
        filePath: string;
        confidence: "strong" | "medium" | "weak";
      } | null>,
    findWuu: (cwd: string, startedAt?: string) =>
      ipcRenderer.invoke("session:find-wuu", cwd, startedAt) as Promise<{
        sessionId: string;
        filePath: string;
        confidence: "medium" | "weak";
      } | null>,
    getPermissionMode: (sessionId: string, cwd: string) =>
      ipcRenderer.invoke(
        "session:get-permission-mode",
        sessionId,
        cwd,
      ) as Promise<string | null>,
    getBypassState: (type: string, sessionId: string, cwd: string) =>
      ipcRenderer.invoke(
        "session:get-bypass-state",
        type,
        sessionId,
        cwd,
      ) as Promise<boolean>,
    getClaudeByPid: (pid: number) =>
      ipcRenderer.invoke("session:get-claude-by-pid", pid) as Promise<
        string | null
      >,
    getKimiLatest: (cwd: string) =>
      ipcRenderer.invoke("session:get-kimi-latest", cwd) as Promise<
        string | null
      >,
    watch: (type: string, sessionId: string, cwd: string) =>
      ipcRenderer.invoke("session:watch", type, sessionId, cwd) as Promise<{
        ok: boolean;
        reason?: string;
      }>,
    unwatch: (sessionId: string) =>
      ipcRenderer.invoke("session:unwatch", sessionId),
    onTurnComplete: (callback: (sessionId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string) =>
        callback(sessionId);
      ipcRenderer.on("session:turn-complete", listener);
      return () =>
        ipcRenderer.removeListener("session:turn-complete", listener);
    },
  },
  telemetry: {
    attachSession: (input: {
      terminalId: string;
      provider: "claude" | "codex" | "wuu";
      sessionId: string;
      cwd: string;
      confidence: "strong" | "medium" | "weak";
    }) =>
      ipcRenderer.invoke("telemetry:attach-session", input) as Promise<{
        ok: boolean;
        sessionFile: string | null;
      }>,
    detachSession: (terminalId: string) =>
      ipcRenderer.invoke(
        "telemetry:detach-session",
        terminalId,
      ) as Promise<void>,
    updateTerminal: (input: {
      terminalId: string;
      worktreePath?: string;
      provider?: "claude" | "codex" | "wuu" | "unknown";
      ptyId?: number | null;
      shellPid?: number | null;
    }) => ipcRenderer.invoke("telemetry:update-terminal", input),
    getTerminal: (terminalId: string) =>
      ipcRenderer.invoke("telemetry:get-terminal", terminalId),
    getWorkflow: (workflowId: string, repoPath: string) =>
      ipcRenderer.invoke("telemetry:get-workflow", workflowId, repoPath),
    listEvents: (input: {
      terminalId: string;
      limit?: number;
      cursor?: string;
    }) => ipcRenderer.invoke("telemetry:list-events", input),
    onSnapshotChanged: (
      callback: (payload: {
        terminalId: string;
        snapshot: Record<string, unknown>;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { terminalId: string; snapshot: Record<string, unknown> },
      ) => callback(payload);
      ipcRenderer.on("telemetry:snapshot-changed", listener);
      return () =>
        ipcRenderer.removeListener("telemetry:snapshot-changed", listener);
    },
  },
  project: {
    selectDirectory: () => ipcRenderer.invoke("project:select-directory"),
    scan: (dirPath: string) => ipcRenderer.invoke("project:scan", dirPath),
    listChildGitRepos: (dirPath: string) =>
      ipcRenderer.invoke("project:list-child-git-repos", dirPath) as Promise<
        { name: string; path: string }[]
      >,
    rescanWorktrees: (dirPath: string) =>
      ipcRenderer.invoke("project:rescan-worktrees", dirPath),
    createWorktree: (repoPath: string, branch: string) =>
      ipcRenderer.invoke(
        "project:create-worktree",
        repoPath,
        branch,
      ) as Promise<
        | {
            ok: true;
            path: string;
            worktrees: { path: string; branch: string; isMain: boolean }[];
          }
        | { ok: false; error: string }
      >,
    removeWorktree: (
      repoPath: string,
      worktreePath: string,
      force?: boolean,
    ) =>
      ipcRenderer.invoke(
        "project:remove-worktree",
        repoPath,
        worktreePath,
        force,
      ) as Promise<
        | {
            ok: true;
            worktrees: { path: string; branch: string; isMain: boolean }[];
          }
        | { ok: false; error: string }
      >,
    deleteFolder: (projectPath: string) =>
      ipcRenderer.invoke("project:delete-folder", projectPath) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    enableHydra: (dirPath: string) =>
      ipcRenderer.invoke("project:enable-hydra", dirPath),
    checkHydra: (dirPath: string) =>
      ipcRenderer.invoke("project:check-hydra", dirPath) as Promise<
        "missing" | "outdated" | "current"
      >,
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
    discard: (
      worktreePath: string,
      trackedPaths: string[],
      untrackedPaths: string[],
    ) =>
      ipcRenderer.invoke(
        "git:discard",
        worktreePath,
        trackedPaths,
        untrackedPaths,
      ) as Promise<void>,
    commit: (worktreePath: string, message: string) =>
      ipcRenderer.invoke(
        "git:commit",
        worktreePath,
        message,
      ) as Promise<string>,
    push: (worktreePath: string) =>
      ipcRenderer.invoke("git:push", worktreePath) as Promise<string>,
    pull: (worktreePath: string) =>
      ipcRenderer.invoke("git:pull", worktreePath) as Promise<string>,
    amend: (worktreePath: string, message: string) =>
      ipcRenderer.invoke("git:amend", worktreePath, message) as Promise<string>,
    fetch: (worktreePath: string, remote?: string) =>
      ipcRenderer.invoke("git:fetch", worktreePath, remote) as Promise<string>,
    // Stash
    stashList: (worktreePath: string) =>
      ipcRenderer.invoke("git:stash-list", worktreePath) as Promise<
        import("../src/types").GitStashEntry[]
      >,
    stashCreate: (worktreePath: string, message: string, includeUntracked: boolean) =>
      ipcRenderer.invoke("git:stash-create", worktreePath, message, includeUntracked) as Promise<void>,
    stashApply: (worktreePath: string, index: number) =>
      ipcRenderer.invoke("git:stash-apply", worktreePath, index) as Promise<void>,
    stashPop: (worktreePath: string, index: number) =>
      ipcRenderer.invoke("git:stash-pop", worktreePath, index) as Promise<void>,
    stashDrop: (worktreePath: string, index: number) =>
      ipcRenderer.invoke("git:stash-drop", worktreePath, index) as Promise<void>,
    // Branch management
    branchCreate: (worktreePath: string, name: string, startPoint?: string) =>
      ipcRenderer.invoke("git:branch-create", worktreePath, name, startPoint) as Promise<void>,
    branchDelete: (worktreePath: string, name: string, force: boolean) =>
      ipcRenderer.invoke("git:branch-delete", worktreePath, name, force) as Promise<void>,
    branchRename: (worktreePath: string, oldName: string, newName: string) =>
      ipcRenderer.invoke("git:branch-rename", worktreePath, oldName, newName) as Promise<void>,
    // Tags
    tagList: (worktreePath: string) =>
      ipcRenderer.invoke("git:tag-list", worktreePath) as Promise<
        import("../src/types").GitTagInfo[]
      >,
    tagCreate: (worktreePath: string, name: string, ref: string, message?: string) =>
      ipcRenderer.invoke("git:tag-create", worktreePath, name, ref, message) as Promise<void>,
    tagDelete: (worktreePath: string, name: string) =>
      ipcRenderer.invoke("git:tag-delete", worktreePath, name) as Promise<void>,
    // Remotes
    remoteList: (worktreePath: string) =>
      ipcRenderer.invoke("git:remote-list", worktreePath) as Promise<
        import("../src/types").GitRemoteInfo[]
      >,
    remoteAdd: (worktreePath: string, name: string, url: string) =>
      ipcRenderer.invoke("git:remote-add", worktreePath, name, url) as Promise<void>,
    remoteRemove: (worktreePath: string, name: string) =>
      ipcRenderer.invoke("git:remote-remove", worktreePath, name) as Promise<void>,
    remoteRename: (worktreePath: string, oldName: string, newName: string) =>
      ipcRenderer.invoke("git:remote-rename", worktreePath, oldName, newName) as Promise<void>,
    // Merge / Rebase / Cherry-pick
    merge: (worktreePath: string, ref: string) =>
      ipcRenderer.invoke("git:merge", worktreePath, ref) as Promise<string>,
    mergeAbort: (worktreePath: string) =>
      ipcRenderer.invoke("git:merge-abort", worktreePath) as Promise<void>,
    rebase: (worktreePath: string, ref: string) =>
      ipcRenderer.invoke("git:rebase", worktreePath, ref) as Promise<string>,
    rebaseAbort: (worktreePath: string) =>
      ipcRenderer.invoke("git:rebase-abort", worktreePath) as Promise<void>,
    rebaseContinue: (worktreePath: string) =>
      ipcRenderer.invoke("git:rebase-continue", worktreePath) as Promise<string>,
    cherryPick: (worktreePath: string, hash: string) =>
      ipcRenderer.invoke("git:cherry-pick", worktreePath, hash) as Promise<string>,
    cherryPickAbort: (worktreePath: string) =>
      ipcRenderer.invoke("git:cherry-pick-abort", worktreePath) as Promise<void>,
    mergeState: (worktreePath: string) =>
      ipcRenderer.invoke("git:merge-state", worktreePath) as Promise<
        import("../src/types").GitMergeState
      >,
    // File diff & partial staging
    fileDiff: (worktreePath: string, filePath: string, staged: boolean) =>
      ipcRenderer.invoke("git:file-diff", worktreePath, filePath, staged) as Promise<
        import("../src/types").GitFileDiff
      >,
    stageHunk: (worktreePath: string, filePath: string, hunkHeader: string) =>
      ipcRenderer.invoke("git:stage-hunk", worktreePath, filePath, hunkHeader) as Promise<void>,
    unstageHunk: (worktreePath: string, filePath: string, hunkHeader: string) =>
      ipcRenderer.invoke("git:unstage-hunk", worktreePath, filePath, hunkHeader) as Promise<void>,
    // Blame
    blame: (worktreePath: string, filePath: string) =>
      ipcRenderer.invoke("git:blame", worktreePath, filePath) as Promise<
        import("../src/types").GitBlameEntry[]
      >,
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
      ipcRenderer.invoke(
        "workspace:save-to-path",
        filePath,
        data,
      ) as Promise<void>,
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
        { type: string; content: string } | { error: string; size?: string }
      >,
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke("fs:write-file", filePath, content) as Promise<{
        changed: boolean;
      }>,
    copy: (sources: string[], destDir: string) =>
      ipcRenderer.invoke("fs:copy", sources, destDir) as Promise<{
        copied: string[];
        skipped: string[];
      }>,
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
    watchDir: (dirPath: string) =>
      ipcRenderer.invoke("fs:watch-dir", dirPath) as Promise<void>,
    unwatchDir: (dirPath: string) =>
      ipcRenderer.invoke("fs:unwatch-dir", dirPath) as Promise<void>,
    unwatchAllDirs: () =>
      ipcRenderer.invoke("fs:unwatch-all-dirs") as Promise<void>,
    onDirChanged: (callback: (dirPath: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, dirPath: string) =>
        callback(dirPath);
      ipcRenderer.on("fs:dir-changed", listener);
      return () => ipcRenderer.removeListener("fs:dir-changed", listener);
    },
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
    register: () => ipcRenderer.invoke("cli:register") as Promise<boolean>,
    unregister: () => ipcRenderer.invoke("cli:unregister") as Promise<boolean>,
    validateCommand: (command: string, args?: string[]) =>
      ipcRenderer.invoke("cli:validate-command", command, args) as Promise<
        | { ok: true; resolvedPath: string; version: string | null }
        | { ok: false; error: string }
      >,
  },
  fonts: {
    getPath: () => ipcRenderer.invoke("font:get-path") as Promise<string>,
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
    query: (dateStr: string) => ipcRenderer.invoke("usage:query", dateStr),
    heatmap: () => ipcRenderer.invoke("usage:heatmap"),
    queryCloud: (dateStr: string) =>
      ipcRenderer.invoke("usage:query-cloud", dateStr),
    heatmapCloud: () => ipcRenderer.invoke("usage:heatmap-cloud"),
  },
  quota: {
    fetch: () => ipcRenderer.invoke("quota:fetch"),
  },
  codexQuota: {
    fetch: () => ipcRenderer.invoke("codex-quota:fetch"),
  },
  summary: {
    generate: (input: {
      terminalId: string;
      sessionId: string;
      sessionType: "claude" | "codex";
      cwd: string;
      summaryCli: "claude" | "codex";
    }) =>
      ipcRenderer.invoke("summary:generate", input) as Promise<{
        ok: boolean;
        summary?: string;
        error?: string;
      }>,
  },
  insights: {
    generate: (cliTool: "claude" | "codex", jobId: string) =>
      ipcRenderer.invoke("insights:generate", cliTool, jobId) as Promise<
        | { ok: true; jobId: string; reportPath: string }
        | {
            ok: false;
            jobId: string;
            error: { code: string; message: string; detail?: string };
          }
      >,
    onProgress: (
      callback: (progress: {
        jobId: string;
        stage: string;
        current: number;
        total: number;
        message: string;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: {
          jobId: string;
          stage: string;
          current: number;
          total: number;
          message: string;
        },
      ) => callback(progress);
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
    onAuthStateChange: (
      callback: (
        user: {
          id: string;
          username: string;
          avatarUrl: string;
          email: string;
        } | null,
      ) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        user: {
          id: string;
          username: string;
          avatarUrl: string;
          email: string;
        } | null,
      ) => callback(user);
      ipcRenderer.on("auth:state-changed", listener);
      return () => ipcRenderer.removeListener("auth:state-changed", listener);
    },
  },
  secure: {
    isAvailable: (): Promise<boolean> =>
      ipcRenderer.invoke("secure:is-available"),
    encrypt: (plaintext: string): Promise<string> =>
      ipcRenderer.invoke("secure:encrypt", plaintext),
    decrypt: (base64: string): Promise<string> =>
      ipcRenderer.invoke("secure:decrypt", base64),
  },
  agent: {
    start: (
      sessionId: string,
      config: {
        type: "claude-code";
        cwd?: string;
        resumeSessionId?: string;
        baseURL: string;
        apiKey: string;
        model: string;
      },
    ): Promise<{ slashCommands: string[] }> =>
      ipcRenderer.invoke("agent:start", sessionId, config),
    send: (
      sessionId: string,
      text: string,
      config: {
        type: "anthropic" | "openai" | "claude-code";
        baseURL: string;
        apiKey: string;
        model: string;
      },
    ) => ipcRenderer.invoke("agent:send", sessionId, text, config),
    abort: (sessionId: string) => ipcRenderer.invoke("agent:abort", sessionId),
    clear: (sessionId: string) => ipcRenderer.invoke("agent:clear", sessionId),
    delete: (sessionId: string) =>
      ipcRenderer.invoke("agent:delete", sessionId),
    approve: (sessionId: string, requestId: string) =>
      ipcRenderer.invoke("agent:approve", sessionId, requestId),
    deny: (sessionId: string, requestId: string, reason?: string) =>
      ipcRenderer.invoke("agent:deny", sessionId, requestId, reason),
    onEvent: (callback: (sessionId: string, event: unknown) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        sessionId: string,
        agentEvent: unknown,
      ) => callback(sessionId, agentEvent);
      ipcRenderer.on("agent:event", listener);
      return () => ipcRenderer.removeListener("agent:event", listener);
    },
  },
  app: {
    homePath: process.env.HOME ?? process.env.USERPROFILE ?? "",
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
    getVersion: () =>
      ipcRenderer.invoke("updater:get-version") as Promise<string>,
    onUpdateAvailable: (
      callback: (info: {
        version: string;
        releaseNotes: string;
        releaseDate: string;
      }) => void,
    ) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        info: { version: string; releaseNotes: string; releaseDate: string },
      ) => callback(info);
      ipcRenderer.on("updater:update-available", listener);
      return () =>
        ipcRenderer.removeListener("updater:update-available", listener);
    },
    onDownloadProgress: (callback: (progress: { percent: number }) => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        progress: { percent: number },
      ) => callback(progress);
      ipcRenderer.on("updater:download-progress", listener);
      return () =>
        ipcRenderer.removeListener("updater:download-progress", listener);
    },
    onUpdateDownloaded: (
      callback: (info: {
        version: string;
        releaseNotes: string;
        releaseDate: string;
      }) => void,
    ) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        info: { version: string; releaseNotes: string; releaseDate: string },
      ) => callback(info);
      ipcRenderer.on("updater:update-downloaded", listener);
      return () =>
        ipcRenderer.removeListener("updater:update-downloaded", listener);
    },
    onError: (callback: (error: { message: string }) => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        error: { message: string },
      ) => callback(error);
      ipcRenderer.on("updater:error", listener);
      return () => ipcRenderer.removeListener("updater:error", listener);
    },
  },
  hooks: {
    getSocketPath: () =>
      ipcRenderer.invoke("hook:get-socket-path") as Promise<string | null>,
    getHealth: () =>
      ipcRenderer.invoke("hook:get-health") as Promise<{
        socketPath: string | null;
        lastEventAt: string | null;
        eventsReceived: number;
        parseErrors: number;
      }>,
    onSessionStarted: (
      callback: (payload: {
        terminalId: string;
        sessionId: string;
        transcriptPath: string | null;
        cwd: string | null;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: {
          terminalId: string;
          sessionId: string;
          transcriptPath: string | null;
          cwd: string | null;
        },
      ) => callback(payload);
      ipcRenderer.on("hook:session-started", listener);
      return () => ipcRenderer.removeListener("hook:session-started", listener);
    },
    onTurnComplete: (
      callback: (payload: {
        terminalId: string;
        sessionId: string | null;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { terminalId: string; sessionId: string | null },
      ) => callback(payload);
      ipcRenderer.on("hook:turn-complete", listener);
      return () => ipcRenderer.removeListener("hook:turn-complete", listener);
    },
    onStopFailure: (
      callback: (payload: {
        terminalId: string;
        sessionId: string | null;
        error: string | null;
        errorDetails: string | null;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: {
          terminalId: string;
          sessionId: string | null;
          error: string | null;
          errorDetails: string | null;
        },
      ) => callback(payload);
      ipcRenderer.on("hook:stop-failure", listener);
      return () => ipcRenderer.removeListener("hook:stop-failure", listener);
    },
  },
  sessions: {
    onListChanged: (callback: (sessions: unknown[]) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        sessions: unknown[],
      ) => callback(sessions);
      ipcRenderer.on("sessions:list-changed", listener);
      return () =>
        ipcRenderer.removeListener("sessions:list-changed", listener);
    },
    loadReplay: (filePath: string) =>
      ipcRenderer.invoke("sessions:load-replay", filePath),
  },
  menu: {
    onOpenFolder: (callback: (dirPath: string) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, dirPath: string) =>
        callback(dirPath);
      ipcRenderer.on("menu:open-folder", listener);
      return () => ipcRenderer.removeListener("menu:open-folder", listener);
    },
  },
});
