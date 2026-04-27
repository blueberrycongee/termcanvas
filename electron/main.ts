import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  nativeImage,
  shell,
  safeStorage,
  protocol,
  net,
} from "electron";
import https from "https";
import path from "path";
import fs from "fs";
import AdmZip from "adm-zip";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";
import { PtyManager, OutputBatcher } from "./pty-manager";
import { ProjectScanner } from "./project-scanner";
import { StatePersistence, TERMCANVAS_DIR } from "./state-persistence";
import { SnapshotHistory } from "./snapshot-history";
import { GitFileWatcher } from "./git-watcher";
import { FileTreeWatcher } from "./file-tree-watcher";
import {
  SessionWatcher,
  resolveSessionFile,
  type SessionType,
} from "./session-watcher";
import { ApiServer } from "./api-server";
import { PinStore } from "./pin-store";
import { sendToWindow } from "./window-events";
import { detectCli } from "./process-detector";
import { ensureCliLauncher } from "./cli-launchers";
import { getAgentShimDir, getTerminalExtraPathEntries } from "./agent-shims";
import {
  isCliRegistered,
  registerCli,
  unregisterCli,
} from "./cli-registration";
import {
  ensureSkillLinks,
  getSkillsSourceDir,
  installSkillLinks,
} from "./skill-manager";
import {
  readCliIntegrationState,
  syncCliIntegrationOnStartup,
  writeCliIntegrationState,
} from "./cli-integration";
import {
  checkHydraProjectStatus,
  enableHydraForProject,
} from "./hydra-project.ts";
import { buildLaunchSpec } from "./pty-launch.js";
import {
  createDefaultComposerSubmitDeps,
  submitComposerRequest,
} from "./composer-submit";
import { collectUsage, collectHeatmapData } from "./usage-collector";
import { buildGitWorktreeRemoveArgs } from "../hydra/src/cleanup";
import {
  installDownloadedUpdate,
  setupAutoUpdater,
  stopAutoUpdater,
} from "./auto-updater";
import {
  initAuth,
  login,
  logout,
  getAuthUser,
  getDeviceId,
  handleAuthCallback,
  onAuthStateChange,
  isLoggedIn,
} from "./auth";
import { toFileUrl } from "./file-url";
import {
  queryCloudUsage,
  queryCloudHeatmap,
  backfillHistory,
  flushSyncQueue,
  syncRecentRecords,
} from "./usage-sync";
import type {
  ComposerSubmitRequest,
  ComposerSupportedTerminalType,
} from "../src/types";
import { buildPinComposerPayload } from "./pin-dispatch";
import { getProjectDiff } from "./git-diff";
import { searchFileContents, searchSessionContents } from "./search-handlers";
import {
  invalidateSessionIndexForFile,
  listSessionsForProjects,
  listSessionsForProjectsPaged,
  type SessionSearchEntry,
} from "./session-search-index";
import {
  buildSessionHistoryScope,
  diffSessionHistoryScopes,
} from "./session-history-events.ts";
import type { SessionHistoryChangedEvent } from "../shared/sessions.ts";
import {
  checkoutGitRef,
  createCommit,
  discardFiles,
  getGitBranches,
  getGitCommitDetail,
  getGitLog,
  getGitStatus,
  gitPull,
  gitPush,
  initGitRepo,
  isGitRepo,
  stageFiles,
  unstageFiles,
  amendCommit,
  listStashes,
  createStash,
  applyStash,
  popStash,
  dropStash,
  createBranch,
  deleteBranch,
  renameBranch,
  listTags,
  createTag,
  deleteTag,
  listRemotes,
  addRemote,
  removeRemote,
  renameRemote,
  gitFetch,
  gitMerge,
  gitMergeAbort,
  gitRebase,
  gitRebaseAbort,
  gitRebaseContinue,
  gitCherryPick,
  gitCherryPickAbort,
  getMergeState,
  getFileDiff,
  stageHunk,
  unstageHunk,
  getBlame,
} from "./git-info";
import { createMenu } from "./menu";
import { isSelectAllShortcutInput } from "./select-all-shortcut";
import { isReloadShortcutInput } from "./reload-shortcut";
import { TelemetryService } from "./telemetry-service";
import { createRenderDiagnosticsLogger } from "./render-diagnostics";
import { HookReceiver } from "./hook-receiver";
import {
  findBestClaudeSession,
  findBestCodexSession,
  findBestKimiSession,
  findBestWuuSession,
  readClaudeSessionPermissionMode,
  readCodexSessionBypassState,
  readLatestCodexSessionId,
} from "./session-discovery";
import { AgentService, type AgentConfig } from "./agent-service";
import { ComputerUseManager } from "./computer-use-manager";
import { SessionScanner } from "./session-scanner.ts";
import { mergeAndDedupeSessions } from "./session-list.ts";
import type { RenderDiagnosticEventInput } from "../shared/render-diagnostics";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !!process.env.VITE_DEV_SERVER_URL;
if (isDev) {
  app.setPath("userData", path.join(app.getPath("appData"), "termcanvas-dev"));
}

// Custom scheme for serving pin image attachments from disk. Renderer-side
// `<img src="tc-attachment://local/<abs-path>">` resolves through the handler
// registered after app.whenReady. Must be declared as privileged BEFORE the
// app is ready, otherwise Chromium treats it as opaque and blocks subresources.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "tc-attachment",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);
const skipLock = isDev || !!process.env.TERMCANVAS_SKIP_LOCK;
const gotLock = skipLock || app.requestSingleInstanceLock();
if (!gotLock) {
  console.error(
    "[TermCanvas] Another instance is already running. Quitting.\n" +
      "  Kill the old process first: pkill -f Electron",
  );
  app.quit();
}

const PORT_FILE = path.join(TERMCANVAS_DIR, "port");

function perfLog(label: string, details: Record<string, unknown>) {
  if (!isDev) return;
  console.log(`[Perf] ${label}`, details);
}

function writePortFile(port: number) {
  fs.writeFileSync(PORT_FILE, `${port}\n${process.pid}`, "utf-8");
}

function cleanupPortFile() {
  try {
    fs.unlinkSync(PORT_FILE);
  } catch {}
}

function emitSessionHistoryChanged(payload: SessionHistoryChangedEvent) {
  const projectDirs = payload.projectDirs
    .map((dir) => dir.trim())
    .filter(Boolean);
  if (projectDirs.length === 0) {
    return;
  }

  sendToWindow(mainWindow, "session-history:changed", {
    ...payload,
    projectDirs,
  });
}

const HIDDEN_DIRS = new Set([".git"]);

let mainWindow: BrowserWindow | null = null;
const ptyManager = new PtyManager();
const outputBatcher = new OutputBatcher((ptyId, data) => {
  sendToWindow(mainWindow, "terminal:output", ptyId, data);
});
const projectScanner = new ProjectScanner();
const statePersistence = new StatePersistence();
const snapshotHistory = new SnapshotHistory();
const gitWatcher = new GitFileWatcher();
const fileTreeWatcher = new FileTreeWatcher(HIDDEN_DIRS, (dirPath) => {
  sendToWindow(mainWindow, "fs:dir-changed", dirPath);
});
const sessionWatcher = new SessionWatcher();
const telemetryService = new TelemetryService({
  onSnapshotChanged: (terminalId, snapshot) => {
    sendToWindow(mainWindow, "telemetry:snapshot-changed", {
      terminalId,
      snapshot,
    });
  },
});
const agentService = new AgentService();
const sessionScanner = new SessionScanner();
const renderDiagnostics = createRenderDiagnosticsLogger(
  app.getPath("userData"),
);
let hookSocketPath: string | null = null;
const hookReceiver = new HookReceiver((event) => {
  telemetryService.recordHookEvent(event.terminal_id, event);

  if (event.hook_event_name === "SessionStart" && event.session_id) {
    sendToWindow(mainWindow, "hook:session-started", {
      terminalId: event.terminal_id,
      sessionId: event.session_id,
      transcriptPath: event.transcript_path ?? null,
      cwd: event.cwd ?? null,
    });
  } else if (event.hook_event_name === "Stop") {
    sendToWindow(mainWindow, "hook:turn-complete", {
      terminalId: event.terminal_id,
      sessionId: event.session_id ?? null,
    });
  } else if (event.hook_event_name === "StopFailure") {
    sendToWindow(mainWindow, "hook:stop-failure", {
      terminalId: event.terminal_id,
      sessionId: event.session_id ?? null,
      error: event.error ?? null,
      errorDetails: event.error_details ?? null,
    });
  }
});
const computerUseManager = new ComputerUseManager();
const taskStore = new PinStore(path.join(TERMCANVAS_DIR, "pins"));

taskStore.on("pin:created", (payload: { pin: unknown; repo: string }) => {
  sendToWindow(mainWindow, "pin:event", { type: "pin:created", ...payload });
});
taskStore.on("pin:updated", (payload: { pin: unknown; repo: string }) => {
  sendToWindow(mainWindow, "pin:event", { type: "pin:updated", ...payload });
});
taskStore.on("pin:removed", (payload: { id: string; repo: string }) => {
  sendToWindow(mainWindow, "pin:event", { type: "pin:removed", ...payload });
});

const apiServer = new ApiServer({
  getWindow: () => mainWindow,
  ptyManager,
  projectScanner,
  telemetryService,
  computerUseManager,
  taskStore,
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
    ...(isMac && {
      titleBarStyle: "hiddenInset" as const,
      trafficLightPosition: { x: 14, y: 14 },
    }),
    ...(isWin && {
      titleBarStyle: "hidden" as const,
      titleBarOverlay: {
        color: "#00000000",
        symbolColor: "#888888",
        height: 44,
      },
    }),
    ...(!isMac &&
      !isWin && {
        titleBarStyle: "hidden" as const,
      }),
  });
  const windowId = mainWindow.id;
  renderDiagnostics.recordMainEvent("browser_window_created", {
    isDev,
    window_id: windowId,
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-attach-webview", (_event, webPreferences) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    delete webPreferences.preload;
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (!isDev && isReloadShortcutInput(input)) {
      event.preventDefault();
      return;
    }

    if (!isSelectAllShortcutInput(input)) {
      return;
    }

    event.preventDefault();
    mainWindow?.webContents.send("menu:select-all");
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    renderDiagnostics.recordMainEvent("browser_window_closed", {
      window_id: windowId,
    });
    mainWindow = null;
    rendererReady = false;
  });
  mainWindow.on("focus", () => {
    renderDiagnostics.recordMainEvent("browser_window_focus", {
      window_id: windowId,
      visible: mainWindow?.isVisible() ?? null,
    });
    // macOS re-activation can leave compositor-backed sidebar layers stale
    // until the next input-driven repaint. Force a full redraw on focus so
    // fixed/overflow-hidden panels repaint immediately.
    mainWindow?.webContents.invalidate();
    for (const dirPath of fileTreeWatcher.getWatchedDirs()) {
      sendToWindow(mainWindow, "fs:dir-changed", dirPath);
    }
  });
  mainWindow.on("blur", () => {
    renderDiagnostics.recordMainEvent("browser_window_blur", {
      window_id: windowId,
      visible: mainWindow?.isVisible() ?? null,
    });
  });
  mainWindow.on("show", () => {
    renderDiagnostics.recordMainEvent("browser_window_show", {
      window_id: windowId,
    });
  });
  mainWindow.on("hide", () => {
    renderDiagnostics.recordMainEvent("browser_window_hide", {
      window_id: windowId,
    });
  });
  mainWindow.on("minimize", () => {
    renderDiagnostics.recordMainEvent("browser_window_minimize", {
      window_id: windowId,
    });
  });
  mainWindow.on("restore", () => {
    renderDiagnostics.recordMainEvent("browser_window_restore", {
      window_id: windowId,
    });
  });

  createMenu(mainWindow);
  agentService.setWindow(mainWindow);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  let rendererReady = false;
  mainWindow.webContents.on("did-finish-load", async () => {
    renderDiagnostics.recordMainEvent("renderer_did_finish_load", {
      renderer_ready_before_load: rendererReady,
      window_id: windowId,
    });
    if (rendererReady) {
      console.warn("[PtyManager] renderer reloaded – destroying orphaned PTYs");
      await ptyManager.destroyAll();
    }
    rendererReady = true;
    try {
      const port = await apiServer.start();
      writePortFile(port);
      console.log(`[TermCanvas API] http://127.0.0.1:${port}`);
    } catch (err) {
      console.error("[TermCanvas API] Failed to start:", err);
    }
  });
  mainWindow.on("close", () => {
    renderDiagnostics.recordMainEvent("browser_window_close_requested", {
      renderer_ready: rendererReady,
      window_id: windowId,
    });
  });
}

const DEBUG_LOG = path.join(TERMCANVAS_DIR, "session-debug.log");
function dbg(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(DEBUG_LOG, line);
  } catch {
    /* ignore */
  }
}

function setupIpc() {
  ipcMain.handle(
    "terminal:create",
    async (
      _event,
      options: {
        cwd: string;
        shell?: string;
        args?: string[];
        terminalId?: string;
        terminalType?: string;
        theme?: "dark" | "light";
        workflowId?: string;
        assignmentId?: string;
        repoPath?: string;
      },
    ) => {
      dbg(
        `terminal:create shell=${options.shell ?? "(default)"} args=${JSON.stringify(options.args)} cwd=${options.cwd}`,
      );
      const cliDir = getCliDir();
      const ptyId = await ptyManager.create({
        ...options,
        extraPathEntries: getTerminalExtraPathEntries(
          cliDir,
          options.terminalType,
        ),
        ...(hookSocketPath
          ? { envOverrides: { TERMCANVAS_SOCKET: hookSocketPath } }
          : {}),
      });
      const pid = ptyManager.getPid(ptyId);
      dbg(`terminal:create => ptyId=${ptyId} pid=${pid ?? "null"}`);
      const terminalId = options.terminalId ?? `pty-${ptyId}`;
      telemetryService.registerTerminal({
        terminalId,
        worktreePath: options.cwd,
        provider:
          options.terminalType === "claude" ||
          options.terminalType === "codex" ||
          options.terminalType === "wuu"
            ? options.terminalType
            : "unknown",
        workflowId: options.workflowId,
        assignmentId: options.assignmentId,
        repoPath: options.repoPath,
        ptyId,
        shellPid: pid ?? null,
      });
      telemetryService.recordPtyCreated({
        terminalId,
        ptyId,
        shellPid: pid ?? null,
      });
      ptyManager.onData(ptyId, (data: string) => {
        ptyManager.captureOutput(ptyId, data);
        telemetryService.recordPtyOutputByPtyId(ptyId, data);
        outputBatcher.push(ptyId, data);
      });
      ptyManager.onExit(ptyId, (exitCode: number) => {
        dbg(
          `terminal:exit ptyId=${ptyId} pid=${pid ?? "null"} exitCode=${exitCode}`,
        );
        telemetryService.recordPtyExitByPtyId(ptyId, exitCode);
        sendToWindow(mainWindow, "terminal:exit", ptyId, exitCode);
      });
      return ptyId;
    },
  );

  ipcMain.on("terminal:input", (_event, ptyId: number, data: string) => {
    ptyManager.write(ptyId, data);
    telemetryService.recordPtyInputByPtyId(ptyId, data);
  });

  ipcMain.on(
    "terminal:resize",
    (_event, ptyId: number, cols: number, rows: number) => {
      ptyManager.resize(ptyId, cols, rows);
    },
  );

  ipcMain.on("terminal:theme-changed", (_event, ptyId: number) => {
    ptyManager.notifyThemeChanged(ptyId);
  });

  ipcMain.handle("terminal:destroy", async (_event, ptyId: number) => {
    await ptyManager.destroy(ptyId);
  });

  ipcMain.handle("terminal:get-pid", (_event, ptyId: number) => {
    const pid = ptyManager.getPid(ptyId) ?? null;
    dbg(`terminal:get-pid ptyId=${ptyId} => pid=${pid}`);
    return pid;
  });

  ipcMain.handle("terminal:detect-cli", async (_event, ptyId: number) => {
    const shellPid = ptyManager.getPid(ptyId);
    if (!shellPid) return null;
    return detectCli(shellPid);
  });

  ipcMain.handle("session:get-codex-latest", () => {
    try {
      return readLatestCodexSessionId();
    } catch (err) {
      console.warn(
        "[session:get-codex-latest] failed to read session index:",
        err,
      );
      return null;
    }
  });

  ipcMain.handle(
    "session:find-codex",
    (_event, cwd: string, startedAt?: string) => {
      return findBestCodexSession(cwd, startedAt);
    },
  );

  ipcMain.handle("session:get-claude-by-pid", (_event, pid: number) => {
    try {
      const sessionFile = path.join(
        os.homedir(),
        ".claude",
        "sessions",
        `${pid}.json`,
      );
      const exists = fs.existsSync(sessionFile);
      dbg(
        `session:get-claude-by-pid pid=${pid} file=${sessionFile} exists=${exists}`,
      );
      if (!exists) {
        const sessDir = path.join(os.homedir(), ".claude", "sessions");
        try {
          const files = fs
            .readdirSync(sessDir)
            .filter((f) => f.endsWith(".json"));
          dbg(`  session files in dir: ${files.join(", ")}`);
        } catch {
          /* ignore */
        }
        return null;
      }
      const data = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
      dbg(`  found sessionId=${data.sessionId}`);
      return data.sessionId as string;
    } catch (err) {
      dbg(`  ERROR: ${err}`);
      return null;
    }
  });

  ipcMain.handle(
    "session:find-claude",
    (_event, cwd: string, startedAt?: string, pid?: number | null) => {
      return findBestClaudeSession(cwd, startedAt, pid);
    },
  );

  ipcMain.handle(
    "session:find-wuu",
    (_event, cwd: string, startedAt?: string) => {
      return findBestWuuSession(cwd, startedAt);
    },
  );

  ipcMain.handle(
    "session:find-kimi",
    (_event, cwd: string, startedAt?: string) => {
      return findBestKimiSession(cwd, startedAt);
    },
  );

  ipcMain.handle(
    "session:get-permission-mode",
    (_event, sessionId: string, cwd: string) => {
      return readClaudeSessionPermissionMode(sessionId, cwd);
    },
  );

  ipcMain.handle(
    "session:get-bypass-state",
    (_event, type: string, sessionId: string, cwd: string) => {
      if (type === "claude") {
        return (
          readClaudeSessionPermissionMode(sessionId, cwd) ===
          "bypassPermissions"
        );
      }
      if (type === "codex") {
        return readCodexSessionBypassState(sessionId, cwd);
      }
      return false;
    },
  );

  ipcMain.handle("project:select-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("project:scan", async (_event, dirPath: string) => {
    return await projectScanner.scanAsync(dirPath);
  });

  ipcMain.handle(
    "project:list-child-git-repos",
    async (_event, dirPath: string) => {
      return await projectScanner.listChildGitReposAsync(dirPath);
    },
  );

  ipcMain.handle("project:diff", async (_event, worktreePath: string) => {
    const startedAt = Date.now();
    try {
      const result = await getProjectDiff(worktreePath);
      perfLog("project:diff", {
        worktreePath,
        ms: Date.now() - startedAt,
        files: result.files.length,
        diffLength: result.diff.length,
      });
      return result;
    } catch {
      perfLog("project:diff:error", {
        worktreePath,
        ms: Date.now() - startedAt,
      });
      return { diff: "", files: [] };
    }
  });

  ipcMain.handle(
    "project:rescan-worktrees",
    async (_event, dirPath: string) => {
      return await projectScanner.listWorktreesAsync(dirPath);
    },
  );

  ipcMain.handle(
    "project:create-worktree",
    async (_event, repoPath: string, branch: string) => {
      const trimmedBranch = (branch ?? "").trim();
      if (!trimmedBranch) {
        return { ok: false as const, error: "Branch name is required" };
      }
      if (
        /[\s~^:?*\[\\]/.test(trimmedBranch) ||
        trimmedBranch.startsWith("-")
      ) {
        return { ok: false as const, error: "Invalid branch name" };
      }

      const resolvedRepo = path.resolve(repoPath);
      const sanitizedDirName = trimmedBranch.replace(/[\\/]/g, "-");
      const worktreePath = path.join(
        resolvedRepo,
        ".worktrees",
        sanitizedDirName,
      );

      try {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFileAsync = promisify(execFile);
        await execFileAsync(
          "git",
          ["worktree", "add", "-b", trimmedBranch, worktreePath],
          { cwd: resolvedRepo, maxBuffer: 10 * 1024 * 1024 },
        );
        const worktrees = await projectScanner.listWorktreesAsync(resolvedRepo);
        return { ok: true as const, path: worktreePath, worktrees };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // git errors often include stderr on a trailing line
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle(
    "project:remove-worktree",
    async (_event, repoPath: string, worktreePath: string, force?: boolean) => {
      const resolvedRepo = path.resolve(repoPath);
      const resolvedWorktree = path.resolve(worktreePath);

      try {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFileAsync = promisify(execFile);
        // Reuse the shared --force builder so the renderer/IPC path matches
        // the CLI, hydra, and headless paths exactly. Without --force, git
        // refuses to remove worktrees containing modified or untracked files
        // — which is exactly what worker worktrees produce by design.
        const args = force
          ? buildGitWorktreeRemoveArgs(resolvedWorktree)
          : ["worktree", "remove", resolvedWorktree];
        await execFileAsync("git", args, {
          cwd: resolvedRepo,
          maxBuffer: 10 * 1024 * 1024,
        });
        const worktrees = await projectScanner.listWorktreesAsync(resolvedRepo);
        return { ok: true as const, worktrees };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle(
    "project:delete-folder",
    async (_event, projectPath: string) => {
      try {
        const resolved = path.resolve(projectPath);
        const home = os.homedir();
        const root = path.parse(resolved).root;
        // Safety: refuse to delete obviously dangerous paths.
        if (
          !path.isAbsolute(resolved) ||
          resolved === root ||
          resolved === home ||
          home.startsWith(resolved + path.sep) ||
          resolved.split(path.sep).filter(Boolean).length < 2
        ) {
          return {
            ok: false as const,
            error: `Refusing to delete unsafe path: ${resolved}`,
          };
        }
        const { rm } = await import("fs/promises");
        await rm(resolved, { recursive: true, force: true });
        return { ok: true as const };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
  );

  ipcMain.handle("project:enable-hydra", (_event, dirPath: string) => {
    return enableHydraForProject(dirPath);
  });

  ipcMain.handle("project:check-hydra", (_event, dirPath: string) => {
    return checkHydraProjectStatus(dirPath);
  });

  ipcMain.handle("git:watch", (_event, worktreePath: string) => {
    gitWatcher.watch(worktreePath, {
      onChanged: () => {
        sendToWindow(mainWindow, "git:changed", worktreePath);
      },
      onLogChanged: () => {
        sendToWindow(mainWindow, "git:log-changed", worktreePath);
      },
      onPresenceChanged: (repoState) => {
        sendToWindow(mainWindow, "git:presence-changed", worktreePath, {
          isGitRepo: repoState,
        });
      },
    });
  });

  ipcMain.handle("git:unwatch", (_event, worktreePath: string) => {
    gitWatcher.unwatch(worktreePath);
  });

  ipcMain.handle("git:is-repo", async (_event, dirPath: string) => {
    return isGitRepo(dirPath);
  });

  ipcMain.handle("git:branches", async (_event, worktreePath: string) => {
    try {
      return await getGitBranches(worktreePath);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "git:log",
    async (_event, worktreePath: string, count?: number) => {
      try {
        return await getGitLog(worktreePath, count);
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(
    "git:commit-detail",
    async (_event, worktreePath: string, hash: string) => {
      return getGitCommitDetail(worktreePath, hash);
    },
  );

  ipcMain.handle(
    "git:checkout",
    async (_event, worktreePath: string, ref: string) => {
      return checkoutGitRef(worktreePath, ref);
    },
  );

  ipcMain.handle("git:init", async (_event, worktreePath: string) => {
    return initGitRepo(worktreePath);
  });

  ipcMain.handle("git:status", async (_event, worktreePath: string) => {
    try {
      return await getGitStatus(worktreePath);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "git:stage",
    async (_event, worktreePath: string, paths: string[]) => {
      return stageFiles(worktreePath, paths);
    },
  );

  ipcMain.handle(
    "git:unstage",
    async (_event, worktreePath: string, paths: string[]) => {
      return unstageFiles(worktreePath, paths);
    },
  );

  ipcMain.handle(
    "git:discard",
    async (
      _event,
      worktreePath: string,
      tracked: string[],
      untracked: string[],
    ) => {
      return discardFiles(worktreePath, tracked, untracked);
    },
  );

  ipcMain.handle(
    "git:commit",
    async (_event, worktreePath: string, message: string) => {
      return createCommit(worktreePath, message);
    },
  );

  ipcMain.handle("git:push", async (_event, worktreePath: string) => {
    return gitPush(worktreePath);
  });

  ipcMain.handle("git:pull", async (_event, worktreePath: string) => {
    return gitPull(worktreePath);
  });

  // ── New git handlers ──

  ipcMain.handle(
    "git:amend",
    async (_event, worktreePath: string, message: string) => {
      return amendCommit(worktreePath, message);
    },
  );

  ipcMain.handle("git:stash-list", async (_event, worktreePath: string) => {
    try {
      return await listStashes(worktreePath);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "git:stash-create",
    async (
      _event,
      worktreePath: string,
      message: string,
      includeUntracked: boolean,
    ) => {
      return createStash(worktreePath, message, includeUntracked);
    },
  );

  ipcMain.handle(
    "git:stash-apply",
    async (_event, worktreePath: string, index: number) => {
      return applyStash(worktreePath, index);
    },
  );

  ipcMain.handle(
    "git:stash-pop",
    async (_event, worktreePath: string, index: number) => {
      return popStash(worktreePath, index);
    },
  );

  ipcMain.handle(
    "git:stash-drop",
    async (_event, worktreePath: string, index: number) => {
      return dropStash(worktreePath, index);
    },
  );

  ipcMain.handle(
    "git:branch-create",
    async (_event, worktreePath: string, name: string, startPoint?: string) => {
      return createBranch(worktreePath, name, startPoint);
    },
  );

  ipcMain.handle(
    "git:branch-delete",
    async (_event, worktreePath: string, name: string, force: boolean) => {
      return deleteBranch(worktreePath, name, force);
    },
  );

  ipcMain.handle(
    "git:branch-rename",
    async (_event, worktreePath: string, oldName: string, newName: string) => {
      return renameBranch(worktreePath, oldName, newName);
    },
  );

  ipcMain.handle("git:tag-list", async (_event, worktreePath: string) => {
    try {
      return await listTags(worktreePath);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "git:tag-create",
    async (
      _event,
      worktreePath: string,
      name: string,
      ref: string,
      message?: string,
    ) => {
      return createTag(worktreePath, name, ref, message);
    },
  );

  ipcMain.handle(
    "git:tag-delete",
    async (_event, worktreePath: string, name: string) => {
      return deleteTag(worktreePath, name);
    },
  );

  ipcMain.handle("git:remote-list", async (_event, worktreePath: string) => {
    try {
      return await listRemotes(worktreePath);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "git:remote-add",
    async (_event, worktreePath: string, name: string, url: string) => {
      return addRemote(worktreePath, name, url);
    },
  );

  ipcMain.handle(
    "git:remote-remove",
    async (_event, worktreePath: string, name: string) => {
      return removeRemote(worktreePath, name);
    },
  );

  ipcMain.handle(
    "git:remote-rename",
    async (_event, worktreePath: string, oldName: string, newName: string) => {
      return renameRemote(worktreePath, oldName, newName);
    },
  );

  ipcMain.handle(
    "git:fetch",
    async (_event, worktreePath: string, remote?: string) => {
      return gitFetch(worktreePath, remote);
    },
  );

  ipcMain.handle(
    "git:merge",
    async (_event, worktreePath: string, ref: string) => {
      return gitMerge(worktreePath, ref);
    },
  );

  ipcMain.handle("git:merge-abort", async (_event, worktreePath: string) => {
    return gitMergeAbort(worktreePath);
  });

  ipcMain.handle(
    "git:rebase",
    async (_event, worktreePath: string, ref: string) => {
      return gitRebase(worktreePath, ref);
    },
  );

  ipcMain.handle("git:rebase-abort", async (_event, worktreePath: string) => {
    return gitRebaseAbort(worktreePath);
  });

  ipcMain.handle(
    "git:rebase-continue",
    async (_event, worktreePath: string) => {
      return gitRebaseContinue(worktreePath);
    },
  );

  ipcMain.handle(
    "git:cherry-pick",
    async (_event, worktreePath: string, hash: string) => {
      return gitCherryPick(worktreePath, hash);
    },
  );

  ipcMain.handle(
    "git:cherry-pick-abort",
    async (_event, worktreePath: string) => {
      return gitCherryPickAbort(worktreePath);
    },
  );

  ipcMain.handle("git:merge-state", async (_event, worktreePath: string) => {
    return getMergeState(worktreePath);
  });

  ipcMain.handle(
    "git:file-diff",
    async (_event, worktreePath: string, filePath: string, staged: boolean) => {
      return getFileDiff(worktreePath, filePath, staged);
    },
  );

  ipcMain.handle(
    "git:stage-hunk",
    async (
      _event,
      worktreePath: string,
      filePath: string,
      hunkHeader: string,
    ) => {
      return stageHunk(worktreePath, filePath, hunkHeader);
    },
  );

  ipcMain.handle(
    "git:unstage-hunk",
    async (
      _event,
      worktreePath: string,
      filePath: string,
      hunkHeader: string,
    ) => {
      return unstageHunk(worktreePath, filePath, hunkHeader);
    },
  );

  ipcMain.handle(
    "git:blame",
    async (_event, worktreePath: string, filePath: string) => {
      return getBlame(worktreePath, filePath);
    },
  );

  // ── Search handlers ──

  ipcMain.handle(
    "search:file-contents",
    async (_event, query: string, worktreePath?: string) => {
      try {
        return await searchFileContents(worktreePath ?? "", query);
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle("search:session-contents", async (_event, query: string) => {
    try {
      return await searchSessionContents(query);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "search:sessions:list",
    async (_event, projectDirs: string[]): Promise<SessionSearchEntry[]> => {
      try {
        return await listSessionsForProjects(projectDirs ?? []);
      } catch (err) {
        // Surface to main-process logs rather than silently returning
        // an empty list — a bug in listSessionsForProjects used to
        // look exactly like "no history exists", which made the
        // `findKimiSessionFiles` missing-import regression in v0.31.0
        // almost impossible to track down.
        console.error("[search:sessions:list] failed", err);
        return [];
      }
    },
  );

  ipcMain.handle(
    "search:sessions:list-page",
    async (
      _event,
      projectDirs: string[],
      options: { limit: number; offset?: number },
    ): Promise<{ entries: SessionSearchEntry[]; total: number }> => {
      try {
        return await listSessionsForProjectsPaged(projectDirs ?? [], options);
      } catch (err) {
        console.error("[search:sessions:list-page] failed", err);
        return { entries: [], total: 0 };
      }
    },
  );

  ipcMain.handle(
    "session:watch",
    (_event, type: SessionType, sessionId: string, cwd: string) => {
      return sessionWatcher.watch(sessionId, type, cwd, () => {
        sendToWindow(mainWindow, "session:turn-complete", sessionId);
      });
    },
  );

  ipcMain.handle("session:unwatch", (_event, sessionId: string) => {
    sessionWatcher.unwatch(sessionId);
  });

  ipcMain.handle(
    "telemetry:attach-session",
    (
      _event,
      input: {
        terminalId: string;
        provider: "claude" | "codex" | "kimi" | "wuu";
        sessionId: string;
        cwd: string;
        confidence: "strong" | "medium" | "weak";
      },
    ) => {
      const sessionFile = resolveSessionFile(
        input.sessionId,
        input.provider,
        input.cwd,
      );
      telemetryService.attachSessionSource({
        terminalId: input.terminalId,
        provider: input.provider,
        sessionId: input.sessionId,
        confidence: input.confidence,
        sessionFile: sessionFile ?? undefined,
      });
      if (sessionFile) {
        invalidateSessionIndexForFile(sessionFile);
        emitSessionHistoryChanged({
          reason: "session_attached",
          projectDirs: [input.cwd],
        });
      }
      return {
        ok: sessionFile !== null,
        sessionFile,
      };
    },
  );

  ipcMain.handle("telemetry:detach-session", (_event, terminalId: string) => {
    const snapshot = telemetryService.getTerminalSnapshot(terminalId);
    telemetryService.detachSessionSource(terminalId);
    if (snapshot?.session_file) {
      invalidateSessionIndexForFile(snapshot.session_file);
    }
    emitSessionHistoryChanged({
      reason: "session_detached",
      projectDirs: snapshot?.worktree_path ? [snapshot.worktree_path] : [],
    });
  });

  ipcMain.handle(
    "telemetry:update-terminal",
    (
      _event,
      input: {
        terminalId: string;
        worktreePath?: string;
        provider?: "claude" | "codex" | "wuu" | "unknown";
        ptyId?: number | null;
        shellPid?: number | null;
      },
    ) => {
      return telemetryService.updateTerminal(input);
    },
  );

  ipcMain.handle("telemetry:get-terminal", (_event, terminalId: string) => {
    return telemetryService.getTerminalSnapshot(terminalId);
  });

  ipcMain.handle(
    "telemetry:get-workflow",
    (_event, workflowId: string, repoPath: string) => {
      return telemetryService.getWorkflowSnapshot(repoPath, workflowId);
    },
  );

  ipcMain.handle(
    "telemetry:list-events",
    (
      _event,
      input: {
        terminalId: string;
        limit?: number;
        cursor?: string;
      },
    ) => {
      return telemetryService.listTerminalEvents(input);
    },
  );

  ipcMain.handle(
    "diagnostics:record-render-event",
    (_event, input: RenderDiagnosticEventInput) => {
      renderDiagnostics.recordRendererEvent(input);
    },
  );

  ipcMain.handle("diagnostics:get-render-log-info", () => {
    return renderDiagnostics.getLogInfo();
  });

  ipcMain.handle("hook:get-socket-path", () => hookSocketPath);
  ipcMain.handle("hook:get-health", () => hookReceiver.getHealth());

  ipcMain.handle("sessions:load-replay", async (_event, filePath: string) => {
    return sessionScanner.loadReplay(filePath);
  });

  ipcMain.handle(
    "sessions:fork",
    async (
      _event,
      sourceFilePath: string,
      turnIndex: number,
      targetProvider?: "claude" | "codex",
    ) => {
      const { forkSession } = await import("./session-fork.js");
      return forkSession(sourceFilePath, turnIndex, targetProvider);
    },
  );

  ipcMain.handle("state:load", () => {
    return statePersistence.load();
  });

  ipcMain.handle("state:save", (_event, state: unknown) => {
    statePersistence.save(state);
  });

  ipcMain.handle("snapshots:list", () => {
    return snapshotHistory.list();
  });

  ipcMain.handle("snapshots:read", (_event, id: string) => {
    return snapshotHistory.read(id);
  });

  ipcMain.handle(
    "snapshots:append",
    (
      _event,
      args: {
        savedAt: number;
        terminalCount: number;
        projectCount: number;
        label?: string;
        body: unknown;
      },
    ) => {
      return snapshotHistory.append(args);
    },
  );

  ipcMain.handle("memory:scan", async (_event, worktreePath: string) => {
    const { getMemoryDirForWorktree, scanMemoryDir } =
      await import("./memory-service.js");
    const memDir = getMemoryDirForWorktree(worktreePath);
    return scanMemoryDir(memDir);
  });

  ipcMain.handle("memory:watch", async (_event, worktreePath: string) => {
    const { getMemoryDirForWorktree, watchMemoryDir, scanMemoryDir } =
      await import("./memory-service.js");
    const { generateEnhancedIndex, MemoryIndexCache } =
      await import("./memory-index-generator.js");
    const memDir = getMemoryDirForWorktree(worktreePath);
    const cache = new MemoryIndexCache(TERMCANVAS_DIR);

    const initialGraph = scanMemoryDir(memDir);
    cache.update(generateEnhancedIndex(initialGraph.nodes));

    watchMemoryDir(memDir, () => {
      try {
        const graph = scanMemoryDir(memDir);
        sendToWindow(mainWindow, "memory:changed", graph);
        cache.update(generateEnhancedIndex(graph.nodes));
      } catch {}
    });
  });

  ipcMain.handle("memory:unwatch", async (_event, worktreePath: string) => {
    const { getMemoryDirForWorktree, unwatchMemoryDir } =
      await import("./memory-service.js");
    const memDir = getMemoryDirForWorktree(worktreePath);
    unwatchMemoryDir(memDir);
  });

  ipcMain.handle("workspace:save", async (_event, data: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Save Workspace",
      defaultPath: "workspace.termcanvas",
      filters: [{ name: "TermCanvas Workspace", extensions: ["termcanvas"] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, data, "utf-8");
    return result.filePath;
  });

  ipcMain.handle(
    "workspace:save-to-path",
    (_event, filePath: string, data: string) => {
      fs.writeFileSync(filePath, data, "utf-8");
    },
  );

  ipcMain.handle("workspace:set-title", (_event, title: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(title);
    }
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

  const IMAGE_EXTS_FS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".bmp",
    ".ico",
    ".avif",
    ".apng",
  ]);
  const MIME_MAP_FS: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
    ".apng": "image/apng",
  };
  // 512 KB is fine for text files but tiny for images — a typical
  // screenshot is 1-2 MB and GIFs easily hit 5-10 MB. Use a separate
  // larger cap for images so clicking an image in the file tree
  // isn't silently blocked most of the time.
  const MAX_FILE_SIZE = 512 * 1024;
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

  ipcMain.handle("fs:list-dir", (_event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const filtered = entries
        .filter((e) => !HIDDEN_DIRS.has(e.name))
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
      const ext = path.extname(filePath).toLowerCase();
      const isImage = IMAGE_EXTS_FS.has(ext);
      // Image files get a 10-MB ceiling since a 5-MB GIF or
      // 2-MB screenshot is perfectly normal and rejecting those
      // just makes the editor look broken. Text keeps the tight
      // 512-KB cap.
      const ceiling = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
      if (stat.size > ceiling) {
        const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
        return { error: "too-large", size: `${sizeMB} MB` };
      }

      if (isImage) {
        const buf = fs.readFileSync(filePath);
        const mime = MIME_MAP_FS[ext] ?? "image/png";
        return {
          type: "image",
          content: `data:${mime};base64,${buf.toString("base64")}`,
        };
      }

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

  ipcMain.handle(
    "fs:write-file",
    (_event, filePath: string, content: string) => {
      try {
        const existing = fs.readFileSync(filePath, "utf-8");
        if (existing === content) return { changed: false };
      } catch {}
      fs.writeFileSync(filePath, content, "utf-8");
      return { changed: true };
    },
  );

  ipcMain.handle(
    "fs:copy",
    async (_event, sources: string[], destDir: string) => {
      const { copyFiles } = await import("./fs-copy.js");
      return copyFiles(sources, destDir);
    },
  );

  ipcMain.handle("fs:rename", (_event, oldPath: string, newName: string) => {
    const basename = path.basename(newName);
    if (basename !== newName || !newName) throw new Error("Invalid name");
    const newPath = path.join(path.dirname(oldPath), newName);
    fs.renameSync(oldPath, newPath);
  });

  ipcMain.handle("fs:delete", (_event, targetPath: string) => {
    fs.rmSync(targetPath, { recursive: true, force: true });
  });

  ipcMain.handle("fs:mkdir", (_event, dirPath: string, name: string) => {
    const basename = path.basename(name);
    if (basename !== name || !name) throw new Error("Invalid name");
    fs.mkdirSync(path.join(dirPath, name), { recursive: true });
  });

  ipcMain.handle("fs:create-file", (_event, dirPath: string, name: string) => {
    const basename = path.basename(name);
    if (basename !== name || !name) throw new Error("Invalid name");
    const filePath = path.join(dirPath, name);
    if (fs.existsSync(filePath)) throw new Error("File already exists");
    fs.writeFileSync(filePath, "", "utf-8");
  });

  ipcMain.handle("fs:reveal", (_event, targetPath: string) => {
    shell.showItemInFolder(targetPath);
  });

  ipcMain.handle("fs:watch-dir", (_event, dirPath: string) => {
    fileTreeWatcher.watch(dirPath);
  });
  ipcMain.handle("fs:unwatch-dir", (_event, dirPath: string) => {
    fileTreeWatcher.unwatch(dirPath);
  });
  ipcMain.handle("fs:unwatch-all-dirs", () => {
    fileTreeWatcher.unwatchAll();
  });

  ipcMain.handle("fs:list-all-files", async (_event, dirPath: string) => {
    try {
      const { execFile } = await import("child_process");
      const output = await new Promise<string>((resolve, reject) => {
        execFile(
          "git",
          ["ls-files", "--cached", "--others", "--exclude-standard"],
          { cwd: dirPath, timeout: 10000 },
          (err, stdout) => (err ? reject(err) : resolve(stdout)),
        );
      });
      const paths = output.split("\n").filter(Boolean);
      return { type: "git" as const, paths };
    } catch {
      // Non-git repo: walk the directory tree recursively
      const paths: string[] = [];
      const visited = new Set<string>();
      // Returns number of file entries added from this subtree. When a
      // directory subtree is entirely empty, emit the directory itself with a
      // trailing "/" so @pierre/trees can still display it.
      const collect = (dir: string, prefix: string): number => {
        let added = 0;
        try {
          const realDir = fs.realpathSync(dir);
          if (visited.has(realDir)) return 0;
          visited.add(realDir);
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (HIDDEN_DIRS.has(entry.name)) continue;
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
              added += collect(path.join(dir, entry.name), relPath);
            } else {
              paths.push(relPath);
              added++;
            }
          }
          if (added === 0 && prefix) paths.push(`${prefix}/`);
        } catch (err) {
          console.error(`[fs:list-all-files] failed to read ${dir}:`, err);
        }
        return added;
      };
      collect(dirPath, "");
      return { type: "dir" as const, paths };
    }
  });

  ipcMain.handle("cli:is-registered", () => isCliRegistered(getCliDir()));
  ipcMain.handle("cli:register", () => {
    const cliOk = registerCli(getCliDir());
    if (!cliOk) {
      return { ok: false, skillInstalled: false };
    }
    writeCliIntegrationState({ autoRegister: true });
    const skillInstalled = installSkill();
    return { ok: true, skillInstalled };
  });
  ipcMain.handle("cli:unregister", () => {
    const ok = unregisterCli(getCliDir());
    if (ok) {
      writeCliIntegrationState({ autoRegister: false });
    }
    return ok;
  });

  ipcMain.handle(
    "cli:validate-command",
    async (_event, command: string, _args?: string[]) => {
      try {
        const spec = await buildLaunchSpec({
          cwd: process.cwd(),
          shell: command,
          extraPathEntries: [getCliDir()],
        });
        const { execFile } = await import("child_process");
        const version = await new Promise<string | null>((resolve) => {
          execFile(
            spec.file,
            ["--version"],
            { timeout: 5000, env: spec.env },
            (err, stdout) => {
              if (err) {
                resolve(null);
                return;
              }
              const line = stdout.toString().trim().split("\n")[0];
              resolve(line || null);
            },
          );
        });
        return { ok: true as const, resolvedPath: spec.file, version };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "composer:submit",
    async (_event, request: ComposerSubmitRequest) => {
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
    },
  );

  ipcMain.handle("usage:query", async (_event, dateStr: string) => {
    const startedAt = Date.now();
    const result = await collectUsage(dateStr);
    perfLog("usage:query", {
      dateStr,
      ms: Date.now() - startedAt,
      sessions: result.sessions,
      totalCost: result.totalCost,
    });
    return result;
  });

  ipcMain.handle("usage:heatmap", async () => {
    const startedAt = Date.now();
    const result = await collectHeatmapData();
    perfLog("usage:heatmap", {
      ms: Date.now() - startedAt,
      days: Object.keys(result).length,
    });
    return result;
  });

  ipcMain.handle("usage:query-cloud", async (_event, dateStr: string) => {
    return await queryCloudUsage(dateStr);
  });

  ipcMain.handle("usage:heatmap-cloud", async () => {
    return await queryCloudHeatmap();
  });

  ipcMain.handle("quota:fetch", async () => {
    const { fetchQuota } = await import("./quota-fetcher");
    const startedAt = Date.now();
    const result = await fetchQuota();
    perfLog("quota:fetch", {
      ms: Date.now() - startedAt,
      ok: result.ok,
      rateLimited: result.ok ? false : result.rateLimited,
    });
    return result;
  });

  ipcMain.handle("codex-quota:fetch", async () => {
    const { fetchCodexQuota } = await import("./codex-quota-fetcher");
    const startedAt = Date.now();
    const result = await fetchCodexQuota();
    perfLog("codex-quota:fetch", {
      ms: Date.now() - startedAt,
      ok: result.ok,
      rateLimited: result.ok ? false : result.rateLimited,
    });
    return result;
  });

  ipcMain.handle(
    "summary:generate",
    async (
      _event,
      input: {
        terminalId: string;
        sessionId: string;
        sessionType: "claude" | "codex";
        cwd: string;
        summaryCli: "claude" | "codex";
      },
    ) => {
      const { generateSummary } = await import("./summary-service.js");
      return generateSummary(input);
    },
  );

  let activeInsightsJobId: string | null = null;
  ipcMain.handle(
    "insights:generate",
    async (_event, cliTool: "claude" | "codex", jobId: string) => {
      if (activeInsightsJobId && activeInsightsJobId !== jobId) {
        return {
          ok: false as const,
          jobId,
          error: {
            code: "job_in_progress",
            message: "Another insights job is already running",
          },
        };
      }

      activeInsightsJobId = jobId;
      try {
        const { generateInsights } = await import("./insights-engine");
        return await generateInsights(cliTool, jobId, (progress) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("insights:progress", progress);
          }
        });
      } finally {
        if (activeInsightsJobId === jobId) {
          activeInsightsJobId = null;
        }
      }
    },
  );

  ipcMain.handle("insights:open-report", async (_event, filePath: string) => {
    await shell.openExternal(toFileUrl(filePath));
  });

  ipcMain.handle("insights:get-last-report", async () => {
    const reportsDir = path.join(TERMCANVAS_DIR, "insights-reports");
    try {
      if (!fs.existsSync(reportsDir)) return null;
      const files = fs
        .readdirSync(reportsDir)
        .filter((f) => f.startsWith("insights-") && f.endsWith(".html"));
      if (files.length === 0) return null;
      files.sort().reverse();
      const filePath = path.join(reportsDir, files[0]);
      if (!fs.existsSync(filePath)) return null;
      return filePath;
    } catch {
      return null;
    }
  });

  const fontsDir = path.join(app.getPath("userData"), "fonts");

  ipcMain.handle("font:get-path", () => fontsDir);

  ipcMain.handle("font:list-downloaded", () => {
    try {
      if (!fs.existsSync(fontsDir)) return [];
      return fs.readdirSync(fontsDir);
    } catch {
      return [];
    }
  });

  ipcMain.handle("font:check", (_event, fileName: string) => {
    return fs.existsSync(path.join(fontsDir, fileName));
  });

  ipcMain.handle(
    "font:download",
    async (_event, url: string, fileName: string) => {
      if (!fs.existsSync(fontsDir)) {
        fs.mkdirSync(fontsDir, { recursive: true });
      }
      const destPath = path.join(fontsDir, fileName);
      if (fs.existsSync(destPath)) {
        return { ok: true, path: destPath };
      }

      try {
        const tmpZip = path.join(fontsDir, `_download_${Date.now()}.zip`);

        const buf = await new Promise<Buffer>((resolve, reject) => {
          const follow = (u: string, redirects = 0) => {
            if (redirects > 5) {
              reject(new Error("Too many redirects"));
              return;
            }
            https
              .get(u, (res) => {
                if (
                  (res.statusCode === 301 || res.statusCode === 302) &&
                  res.headers.location
                ) {
                  follow(res.headers.location, redirects + 1);
                  return;
                }
                if (res.statusCode !== 200) {
                  reject(new Error(`HTTP ${res.statusCode}`));
                  return;
                }
                const chunks: Buffer[] = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => resolve(Buffer.concat(chunks)));
                res.on("error", reject);
              })
              .on("error", reject);
          };
          follow(url);
        });
        if (buf.length < 100) {
          return {
            ok: false,
            error: "Downloaded file is too small, likely not a valid archive",
          };
        }
        fs.writeFileSync(tmpZip, buf);

        const zip = new AdmZip(tmpZip);
        const zipEntries = zip.getEntries();
        const matchEntry = zipEntries.find((e) =>
          e.entryName.endsWith(fileName),
        );
        if (!matchEntry) {
          fs.unlinkSync(tmpZip);
          return {
            ok: false,
            error: `Font file "${fileName}" not found in archive`,
          };
        }
        fs.writeFileSync(destPath, matchEntry.getData());
        fs.unlinkSync(tmpZip);

        return { ok: true, path: destPath };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle("auth:login", async () => {
    return login();
  });

  ipcMain.handle("auth:logout", async () => {
    await logout();
  });

  ipcMain.handle("auth:get-user", () => {
    return getAuthUser();
  });

  ipcMain.handle("auth:get-device-id", () => {
    return getDeviceId();
  });

  ipcMain.on("app:request-close", () => {
    if (mainWindow) {
      mainWindow.close();
    }
  });

  ipcMain.handle(
    "agent:send",
    async (
      _event,
      sessionId: string,
      text: string,
      config: {
        type: "anthropic" | "openai";
        baseURL: string;
        apiKey: string;
        model: string;
      },
    ) => {
      agentService.send(sessionId, text, config);
    },
  );

  ipcMain.handle("agent:abort", (_event, sessionId: string) => {
    agentService.abort(sessionId);
  });

  ipcMain.handle("agent:clear", (_event, sessionId: string) => {
    agentService.clearSession(sessionId);
  });

  ipcMain.handle("agent:delete", (_event, sessionId: string) => {
    agentService.deleteSession(sessionId);
  });

  ipcMain.handle(
    "agent:start",
    (_event, sessionId: string, config: AgentConfig) => {
      agentService.startClaudeCode(sessionId, config);
      const { getSlashCommandNames } =
        require("./slash-commands") as typeof import("./slash-commands");
      return { slashCommands: getSlashCommandNames(config.cwd) };
    },
  );

  ipcMain.handle(
    "agent:approve",
    (_event, sessionId: string, requestId: string) => {
      agentService.approve(sessionId, requestId);
    },
  );

  ipcMain.handle(
    "agent:deny",
    (_event, sessionId: string, requestId: string, reason?: string) => {
      agentService.deny(sessionId, requestId, reason);
    },
  );

  ipcMain.handle("secure:is-available", () =>
    safeStorage.isEncryptionAvailable(),
  );

  ipcMain.handle("secure:encrypt", (_event, plaintext: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage unavailable");
    }
    return safeStorage.encryptString(plaintext).toString("base64");
  });

  ipcMain.handle("secure:decrypt", (_event, base64: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage unavailable");
    }
    return safeStorage.decryptString(Buffer.from(base64, "base64"));
  });

  ipcMain.handle("pin:list", (_event, repo: string) => {
    return taskStore.list(repo);
  });

  ipcMain.handle(
    "pin:create",
    (_event, input: Parameters<typeof taskStore.create>[0]) => {
      return taskStore.create(input);
    },
  );

  ipcMain.handle(
    "pin:update",
    (
      _event,
      repo: string,
      id: string,
      patch: Parameters<typeof taskStore.update>[2],
    ) => {
      return taskStore.update(repo, id, patch);
    },
  );

  ipcMain.handle("pin:remove", (_event, repo: string, id: string) => {
    taskStore.remove(repo, id);
  });

  ipcMain.handle(
    "pin:save-attachment",
    (
      _event,
      repo: string,
      id: string,
      fileName: string,
      data: ArrayBuffer | Uint8Array,
    ) => {
      const buffer = Buffer.from(
        data instanceof Uint8Array ? data : new Uint8Array(data),
      );
      return taskStore.saveAttachment(repo, id, fileName, buffer);
    },
  );

  // Inject a pin's body + image attachments into a terminal via the existing
  // composer-submit pipeline. We deliberately do not mutate pin.status here:
  // dispatching the same pin to multiple terminals is a supported flow, and
  // status changes stay manual.
  ipcMain.handle(
    "pin:dispatch-to-terminal",
    async (
      _event,
      repo: string,
      pinId: string,
      target: {
        terminalId: string;
        ptyId: number;
        terminalType: ComposerSupportedTerminalType;
        worktreePath: string;
      },
    ) => {
      const pin = taskStore.get(repo, pinId);
      if (!pin) {
        return {
          ok: false,
          code: "internal-error" as const,
          stage: "validate" as const,
          error: `Pin not found: ${pinId}`,
          detail: `Pin not found: ${pinId}`,
        };
      }

      if (!ptyManager.getPid(target.ptyId)) {
        return {
          ok: false,
          code: "target-not-running" as const,
          stage: "target" as const,
          error: "Target terminal is not running.",
          detail: "Target terminal is not running.",
        };
      }

      const { text, images } = await buildPinComposerPayload(
        pin,
        taskStore.attachmentsDir(repo, pinId),
      );

      // Paste-only — fill the agent's input buffer with the title + body
      // (and stage attachments) but leave submission to the user. They
      // review the prompt in context, edit if needed, and hit Enter
      // themselves.
      const request: ComposerSubmitRequest = {
        terminalId: target.terminalId,
        ptyId: target.ptyId,
        terminalType: target.terminalType,
        worktreePath: target.worktreePath,
        text,
        images,
        submit: false,
      };

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
          console.error("[Pin] Dispatch failed:", {
            pinId,
            terminalId: target.terminalId,
            ptyId: target.ptyId,
            terminalType: target.terminalType,
            stage: result.stage,
            code: result.code,
            detail: result.detail ?? result.error,
          });
        }

        return result;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[Pin] Dispatch crashed:", {
          pinId,
          terminalId: target.terminalId,
          detail,
        });
        return {
          ok: false,
          code: "internal-error" as const,
          stage: "submit" as const,
          error: detail,
          detail,
        };
      }
    },
  );
}

function getCliDir(): string {
  const prodDir = path.join(process.resourcesPath, "cli");
  if (fs.existsSync(prodDir)) return prodDir;
  return path.resolve(__dirname, "..", "dist-cli");
}

function dataUrlToPngBuffer(dataUrl: string): Buffer {
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) {
    throw new Error("Invalid image data.");
  }
  return image.toPNG();
}

const CLI_NAMES = ["termcanvas", "hydra", "browse"];
const AGENT_SHIM_NAMES = ["codex", "claude"];

function ensureCliLinks(): void {
  const cliDir = getCliDir();
  if (!fs.existsSync(cliDir)) return;

  for (const name of CLI_NAMES) {
    const jsFile = path.join(cliDir, `${name}.js`);
    try {
      ensureCliLauncher(jsFile);
    } catch {}
  }

  const shimDir = getAgentShimDir(cliDir);
  if (!fs.existsSync(shimDir)) return;
  for (const name of AGENT_SHIM_NAMES) {
    const jsFile = path.join(shimDir, `${name}.js`);
    try {
      ensureCliLauncher(jsFile);
    } catch {}
  }
}

function getSkillSourceDir(): string {
  return getSkillsSourceDir(process.resourcesPath, __dirname);
}

function installSkill(): boolean {
  return installSkillLinks({
    sourceDir: getSkillSourceDir(),
    appVersion: app.getVersion(),
  });
}

function ensureSkillInstalled(): boolean {
  return ensureSkillLinks({
    sourceDir: getSkillSourceDir(),
    appVersion: app.getVersion(),
  });
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("termcanvas", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("termcanvas");
}

app.whenReady().then(async () => {
  renderDiagnostics.recordMainEvent("app_ready", {
    app_version: app.getVersion(),
    isDev,
    platform: process.platform,
    user_data_path: app.getPath("userData"),
  });

  // Serve pin attachment images. Path-traversal guard: resolved disk path
  // must stay under TERMCANVAS_DIR/pins/. Renderer constructs URLs as
  // tc-attachment://local/<abs-path>; handler decodes pathname back to a
  // real path and streams the file via Electron's net.fetch.
  const ATTACHMENTS_ROOT = path.join(TERMCANVAS_DIR, "pins");
  protocol.handle("tc-attachment", async (request) => {
    try {
      const url = new URL(request.url);
      const requestedPath = decodeURIComponent(url.pathname);
      const resolved = path.resolve(requestedPath);
      if (
        resolved !== ATTACHMENTS_ROOT &&
        !resolved.startsWith(ATTACHMENTS_ROOT + path.sep)
      ) {
        return new Response("forbidden", { status: 403 });
      }
      return await net.fetch(pathToFileURL(resolved).toString());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(message, { status: 500 });
    }
  });

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") {
      contents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
      });
      // Strip Electron/app identifiers from UA to avoid being blocked by sites
      const ua = contents
        .getUserAgent()
        .replace(/\s*Electron\/\S+/, "")
        .replace(/\s*termcanvas\/\S+/i, "");
      contents.setUserAgent(ua);
    }
  });

  try {
    hookSocketPath = await hookReceiver.start();
  } catch (error) {
    hookSocketPath = null;
    console.error("[HookReceiver] Startup disabled:", error);
  }
  let previousSessionHistoryScope = new Map<string, string>();
  sessionScanner.start((sessions) => {
    const nextSessionHistoryScope = buildSessionHistoryScope(sessions);
    const { projectDirs, invalidatedFilePaths } = diffSessionHistoryScopes(
      previousSessionHistoryScope,
      nextSessionHistoryScope,
    );
    previousSessionHistoryScope = nextSessionHistoryScope;
    for (const filePath of invalidatedFilePaths) {
      invalidateSessionIndexForFile(filePath);
    }

    const managed = telemetryService.getManagedSessions();
    const merged = mergeAndDedupeSessions(managed, sessions);
    sendToWindow(mainWindow, "sessions:list-changed", merged);
    emitSessionHistoryChanged({
      reason: "session_scan_changed",
      projectDirs,
    });
  });
  ensureCliLinks();
  syncCliIntegrationOnStartup({
    autoRegisterEnabled: readCliIntegrationState().autoRegister,
    cliRegistered: isCliRegistered(getCliDir()),
    registerCli: () => registerCli(getCliDir()),
    ensureSkills: ensureSkillInstalled,
    persistAutoRegisterEnabled: (enabled) => {
      writeCliIntegrationState({ autoRegister: enabled });
    },
  });
  setupIpc();
  await initAuth();
  createWindow();
  if (mainWindow) setupAutoUpdater(mainWindow);

  onAuthStateChange((user) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("auth:state-changed", user);
    }
    if (user) {
      backfillHistory().catch((err) =>
        console.error("[Auth] Backfill error:", err),
      );
      flushSyncQueue().catch((err) =>
        console.error("[Auth] Queue flush error:", err),
      );
    }
  });

  setInterval(() => {
    if (isLoggedIn()) {
      flushSyncQueue().catch((err) =>
        console.error("[UsageSync] Periodic flush error:", err),
      );
      syncRecentRecords().catch((err) =>
        console.error("[UsageSync] Periodic sync error:", err),
      );
    }
  }, 5 * 60_000);

  app.on("open-url", async (_event, url) => {
    if (url.startsWith("termcanvas://auth/callback")) {
      await handleAuthCallback(url);
    }
  });

  app.on("second-instance", (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const authUrl = argv.find((arg) =>
      arg.startsWith("termcanvas://auth/callback"),
    );
    if (authUrl) {
      handleAuthCallback(authUrl);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.handle("computer-use:status", () => computerUseManager.getStatus());
ipcMain.handle("computer-use:enable", () => computerUseManager.enable());
ipcMain.handle("computer-use:disable", () => computerUseManager.disable());
ipcMain.handle("computer-use:stop", () => computerUseManager.stop());
ipcMain.handle("computer-use:open-permissions", () =>
  computerUseManager.openPermissions(),
);

computerUseManager.onStateChange((state) => {
  sendToWindow(mainWindow, "computer-use:state-changed", state);
});

let isQuitting = false;
app.on("will-quit", (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  renderDiagnostics.recordMainEvent("app_will_quit", {
    platform: process.platform,
  });
  void (async () => {
    outputBatcher.dispose();
    await ptyManager.destroyAll();
    gitWatcher.unwatchAll();
    fileTreeWatcher.unwatchAll();
    sessionWatcher.unwatchAll();
    hookReceiver.stop();
    stopAutoUpdater();
    apiServer.stop();
    await computerUseManager.shutdown();
    cleanupPortFile();
    app.quit();
  })();
});

app.on("window-all-closed", () => {
  app.quit();
});
