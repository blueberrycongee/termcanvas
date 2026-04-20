import type { SceneDocument } from "./scene";
import type {
  TelemetryEventPage,
  TerminalTelemetrySnapshot,
  WorkflowTelemetrySnapshot,
} from "../../shared/telemetry";
import type {
  RenderDiagnosticEventInput,
  RenderDiagnosticsLogInfo,
} from "../../shared/render-diagnostics";

export * from "./scene";

export type TerminalType =
  | "shell"
  | "claude"
  | "codex"
  | "kimi"
  | "gemini"
  | "opencode"
  | "wuu"
  | "lazygit"
  | "tmux";

export interface Position {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export type TerminalStatus =
  | "running"
  | "active"
  | "waiting"
  | "completed"
  | "success"
  | "error"
  | "idle";

export type ComposerSupportedTerminalType = TerminalType;

export interface ComposerImageAttachment {
  id: string;
  name: string;
  dataUrl: string;
}

export interface ComposerSubmitRequest {
  terminalId: string;
  ptyId: number;
  terminalType: ComposerSupportedTerminalType;
  worktreePath: string;
  text: string;
  images: ComposerImageAttachment[];
}

export type ComposerSubmitIssueStage =
  | "target"
  | "validate"
  | "read-images"
  | "prepare-images"
  | "paste-image"
  | "paste-text"
  | "submit";

export type ComposerSubmitIssueCode =
  | "target-not-running"
  | "unsupported-terminal"
  | "empty-submit"
  | "images-unsupported"
  | "image-read-failed"
  | "image-stage-failed"
  | "pty-write-failed"
  | "submit-key-failed"
  | "internal-error";

export interface ComposerSubmitResult {
  ok: boolean;
  requestId?: string;
  stagedImagePaths?: string[];
  error?: string;
  detail?: string;
  code?: ComposerSubmitIssueCode;
  stage?: ComposerSubmitIssueStage;
}

export type TerminalOrigin = "user" | "agent";

export interface TerminalData {
  id: string;
  title: string;
  customTitle?: string;
  starred?: boolean;
  type: TerminalType;
  minimized: boolean;
  focused: boolean;
  ptyId: number | null;
  status: TerminalStatus;
  x: number;
  y: number;
  width: number;
  height: number;
  tags: string[];
  origin?: TerminalOrigin;
  parentTerminalId?: string;
  scrollback?: string;
  sessionId?: string;
  initialPrompt?: string;
  autoApprove?: boolean;
  stashed?: boolean;
  stashedAt?: number;
}

export interface TerminalRuntimeState {
  ptyId: number | null;
  status: TerminalStatus;
}

export type PersistedTerminalData = Omit<
  TerminalData,
  keyof TerminalRuntimeState
>;

export interface StashedTerminal {
  terminal: TerminalData;
  projectId: string;
  worktreeId: string;
  stashedAt: number;
}

export interface PersistedStashedTerminal {
  terminal: PersistedTerminalData;
  projectId: string;
  worktreeId: string;
  stashedAt: number;
}

export interface WorktreeData {
  id: string;
  name: string;
  path: string;
  terminals: TerminalData[];
}

export interface PersistedWorktreeData extends Omit<WorktreeData, "terminals"> {
  terminals: PersistedTerminalData[];
}

export interface ProjectData {
  id: string;
  name: string;
  path: string;
  worktrees: WorktreeData[];
}

export interface PersistedProjectData extends Omit<ProjectData, "worktrees"> {
  worktrees: PersistedWorktreeData[];
}

export interface CanvasState {
  version?: 1;
  viewport: Viewport;
  projects: ProjectData[];
  drawings?: unknown[];
  browserCards?: Record<string, unknown>;
}

export interface SceneCanvasState {
  version: 2;
  scene: SceneDocument;
}

export type PersistedCanvasState =
  | CanvasState
  | SceneCanvasState
  | { skipRestore: true };

export interface UsageBucket {
  label: string;
  hourStart: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cost: number;
  calls: number;
}

export interface ProjectUsage {
  path: string;
  name: string;
  cost: number;
  calls: number;
}

export type HydraInstructionFileName = "CLAUDE.md" | "AGENTS.md";
export type HydraInstructionStatus =
  | "created"
  | "appended"
  | "updated"
  | "unchanged";

export interface ProjectEnableHydraFileResult {
  fileName: HydraInstructionFileName;
  filePath: string;
  status: HydraInstructionStatus;
}

export interface ProjectEnableHydraSuccess {
  ok: true;
  repoPath: string;
  changed: boolean;
  files: ProjectEnableHydraFileResult[];
}

export interface ProjectEnableHydraFailure {
  ok: false;
  error: string;
}

export type ProjectEnableHydraResult =
  | ProjectEnableHydraSuccess
  | ProjectEnableHydraFailure;

export interface ModelUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cost: number;
  calls: number;
}

export interface UsageSummary {
  date: string;
  sessions: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreate5m: number;
  totalCacheCreate1h: number;
  totalCost: number;
  buckets: UsageBucket[];
  projects: ProjectUsage[];
  models: ModelUsage[];
}

export interface QuotaData {
  fiveHour: { utilization: number; resetsAt: string };
  sevenDay: { utilization: number; resetsAt: string };
  fetchedAt: number;
}

export type QuotaFetchResult =
  | { ok: true; data: QuotaData }
  | { ok: false; rateLimited: boolean };

export interface DeviceUsage {
  deviceId: string;
  tokens: number;
  cost: number;
  calls: number;
}

export interface CloudUsageSummary extends UsageSummary {
  devices: DeviceUsage[];
}

export interface InsightsProgressEvent {
  jobId: string;
  stage:
    | "validating"
    | "scanning"
    | "extracting_facets"
    | "aggregating"
    | "analyzing"
    | "generating_report";
  current: number;
  total: number;
  message: string;
}

export type InsightsGenerateResult =
  | { ok: true; jobId: string; reportPath: string }
  | {
      ok: false;
      jobId: string;
      error: { code: string; message: string; detail?: string };
    };

export interface GitBranchInfo {
  name: string;
  hash: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitLogEntry {
  hash: string;
  parents: string[];
  refs: string[];
  author: string;
  date: string;
  message: string;
}

export interface GitCommitFile {
  name: string;
  additions: number;
  deletions: number;
  binary: boolean;
  isImage: boolean;
  imageOld: string | null;
  imageNew: string | null;
}

export interface GitCommitDetail {
  message: string;
  diff: string;
  files: GitCommitFile[];
}

export type GitFileStatus = "M" | "A" | "D" | "R" | "C" | "U" | "?";

export interface GitStatusEntry {
  path: string;
  status: GitFileStatus;
  staged: boolean;
  originalPath?: string;
}

export interface GitStashEntry {
  index: number;
  message: string;
  hash: string;
  date: string;
}

export interface GitTagInfo {
  name: string;
  hash: string;
  isAnnotated: boolean;
  message: string;
  date: string;
}

export interface GitRemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitBlameEntry {
  hash: string;
  author: string;
  date: string;
  lineStart: number;
  lineCount: number;
  content: string;
}

export interface GitFileDiff {
  hunks: string[];
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
}

export type GitMergeState =
  | { type: "none" }
  | { type: "merge" }
  | { type: "rebase"; current: string; total: string }
  | { type: "cherry-pick" };

export type AgentStreamEvent =
  | { type: "stream_start" }
  | { type: "stream_end" }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_start"; name: string; input: Record<string, unknown> }
  | { type: "tool_end"; name: string; content: string; is_error?: boolean }
  | { type: "turn_start"; turn: number }
  | { type: "turn_end"; turn: number }
  | { type: "error"; error: { message: string } }
  | {
      type: "message_start";
      usage?: { input_tokens: number; output_tokens: number };
    }
  | { type: "message_delta"; stop_reason: string | null }
  | {
      type: "approval_request";
      request_id: string;
      tool_name: string;
      tool_input: Record<string, unknown>;
    }
  | {
      type: "system_init";
      model?: string;
      tools_count?: number;
      session_id?: string;
      slash_commands?: string[];
    }
  | {
      type: "result_info";
      cost_usd?: number;
      input_tokens?: number;
      output_tokens?: number;
      duration_ms?: number;
      num_turns?: number;
    };

export interface TermCanvasAPI {
  terminal: {
    create: (options: {
      cwd: string;
      shell?: string;
      args?: string[];
      terminalId?: string;
      terminalType?: string;
      theme?: "dark" | "light";
    }) => Promise<number>;
    destroy: (ptyId: number) => Promise<void>;
    getPid: (ptyId: number) => Promise<number | null>;
    input: (ptyId: number, data: string) => void;
    resize: (ptyId: number, cols: number, rows: number) => void;
    notifyThemeChanged: (ptyId: number) => void;
    onOutput: (callback: (ptyId: number, data: string) => void) => () => void;
    onExit: (callback: (ptyId: number, exitCode: number) => void) => () => void;
    detectCli: (
      ptyId: number,
    ) => Promise<{
      cliType: TerminalType;
      pid?: number;
      sessionName?: string;
      autoApprove?: boolean;
    } | null>;
  };
  session: {
    getCodexLatest: () => Promise<string | null>;
    findCodex: (
      cwd: string,
      startedAt?: string,
    ) => Promise<{
      sessionId: string;
      filePath: string;
      confidence: "medium" | "weak";
    } | null>;
    findClaude: (
      cwd: string,
      startedAt?: string,
      pid?: number | null,
    ) => Promise<{
      sessionId: string;
      filePath: string;
      confidence: "strong" | "medium" | "weak";
    } | null>;
    findWuu: (
      cwd: string,
      startedAt?: string,
    ) => Promise<{
      sessionId: string;
      filePath: string;
      confidence: "medium" | "weak";
    } | null>;
    getPermissionMode: (
      sessionId: string,
      cwd: string,
    ) => Promise<string | null>;
    getBypassState: (
      type: string,
      sessionId: string,
      cwd: string,
    ) => Promise<boolean>;
    getClaudeByPid: (pid: number) => Promise<string | null>;
    getKimiLatest: (cwd: string) => Promise<string | null>;
    watch: (
      type: string,
      sessionId: string,
      cwd: string,
    ) => Promise<{ ok: boolean; reason?: string }>;
    unwatch: (sessionId: string) => Promise<void>;
    onTurnComplete: (callback: (sessionId: string) => void) => () => void;
  };
  telemetry: {
    attachSession: (input: {
      terminalId: string;
      provider: "claude" | "codex" | "wuu";
      sessionId: string;
      cwd: string;
      confidence: "strong" | "medium" | "weak";
    }) => Promise<{ ok: boolean; sessionFile: string | null }>;
    detachSession: (terminalId: string) => Promise<void>;
    updateTerminal: (input: {
      terminalId: string;
      worktreePath?: string;
      provider?: "claude" | "codex" | "wuu" | "unknown";
      ptyId?: number | null;
      shellPid?: number | null;
    }) => Promise<TerminalTelemetrySnapshot>;
    getTerminal: (
      terminalId: string,
    ) => Promise<TerminalTelemetrySnapshot | null>;
    getWorkflow: (
      workflowId: string,
      repoPath: string,
    ) => Promise<WorkflowTelemetrySnapshot | null>;
    listEvents: (input: {
      terminalId: string;
      limit?: number;
      cursor?: string;
    }) => Promise<TelemetryEventPage>;
    onSnapshotChanged: (
      callback: (payload: {
        terminalId: string;
        snapshot: TerminalTelemetrySnapshot;
      }) => void,
    ) => () => void;
  };
  diagnostics: {
    recordRenderEvent: (input: RenderDiagnosticEventInput) => Promise<void>;
    getRenderLogInfo: () => Promise<RenderDiagnosticsLogInfo>;
  };
  project: {
    selectDirectory: () => Promise<string | null>;
    scan: (dirPath: string) => Promise<{
      name: string;
      path: string;
      worktrees: { path: string; branch: string; isMain: boolean }[];
    } | null>;
    listChildGitRepos: (
      dirPath: string,
    ) => Promise<{ name: string; path: string }[]>;
    rescanWorktrees: (
      dirPath: string,
    ) => Promise<{ path: string; branch: string; isMain: boolean }[]>;
    createWorktree: (
      repoPath: string,
      branch: string,
    ) => Promise<
      | {
          ok: true;
          path: string;
          worktrees: { path: string; branch: string; isMain: boolean }[];
        }
      | { ok: false; error: string }
    >;
    removeWorktree: (
      repoPath: string,
      worktreePath: string,
      force?: boolean,
    ) => Promise<
      | {
          ok: true;
          worktrees: { path: string; branch: string; isMain: boolean }[];
        }
      | { ok: false; error: string }
    >;
    deleteFolder: (
      projectPath: string,
    ) => Promise<{ ok: true } | { ok: false; error: string }>;
    enableHydra: (dirPath: string) => Promise<ProjectEnableHydraResult>;
    checkHydra: (
      dirPath: string,
    ) => Promise<"missing" | "outdated" | "current">;
    diff: (worktreePath: string) => Promise<{
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
    }>;
  };
  git: {
    watch: (worktreePath: string) => Promise<void>;
    unwatch: (worktreePath: string) => Promise<void>;
    branches: (worktreePath: string) => Promise<GitBranchInfo[]>;
    log: (worktreePath: string, count?: number) => Promise<GitLogEntry[]>;
    isRepo: (dirPath: string) => Promise<boolean>;
    commitDetail: (
      worktreePath: string,
      hash: string,
    ) => Promise<GitCommitDetail | null>;
    checkout: (worktreePath: string, ref: string) => Promise<void>;
    init: (worktreePath: string) => Promise<void>;
    status: (worktreePath: string) => Promise<GitStatusEntry[]>;
    stage: (worktreePath: string, paths: string[]) => Promise<void>;
    unstage: (worktreePath: string, paths: string[]) => Promise<void>;
    discard: (
      worktreePath: string,
      trackedPaths: string[],
      untrackedPaths: string[],
    ) => Promise<void>;
    commit: (worktreePath: string, message: string) => Promise<string>;
    push: (worktreePath: string) => Promise<string>;
    pull: (worktreePath: string) => Promise<string>;
    amend: (worktreePath: string, message: string) => Promise<string>;
    fetch: (worktreePath: string, remote?: string) => Promise<string>;
    // Stash
    stashList: (worktreePath: string) => Promise<GitStashEntry[]>;
    stashCreate: (worktreePath: string, message: string, includeUntracked: boolean) => Promise<void>;
    stashApply: (worktreePath: string, index: number) => Promise<void>;
    stashPop: (worktreePath: string, index: number) => Promise<void>;
    stashDrop: (worktreePath: string, index: number) => Promise<void>;
    // Branch management
    branchCreate: (worktreePath: string, name: string, startPoint?: string) => Promise<void>;
    branchDelete: (worktreePath: string, name: string, force: boolean) => Promise<void>;
    branchRename: (worktreePath: string, oldName: string, newName: string) => Promise<void>;
    // Tags
    tagList: (worktreePath: string) => Promise<GitTagInfo[]>;
    tagCreate: (worktreePath: string, name: string, ref: string, message?: string) => Promise<void>;
    tagDelete: (worktreePath: string, name: string) => Promise<void>;
    // Remotes
    remoteList: (worktreePath: string) => Promise<GitRemoteInfo[]>;
    remoteAdd: (worktreePath: string, name: string, url: string) => Promise<void>;
    remoteRemove: (worktreePath: string, name: string) => Promise<void>;
    remoteRename: (worktreePath: string, oldName: string, newName: string) => Promise<void>;
    // Merge / Rebase / Cherry-pick
    merge: (worktreePath: string, ref: string) => Promise<string>;
    mergeAbort: (worktreePath: string) => Promise<void>;
    rebase: (worktreePath: string, ref: string) => Promise<string>;
    rebaseAbort: (worktreePath: string) => Promise<void>;
    rebaseContinue: (worktreePath: string) => Promise<string>;
    cherryPick: (worktreePath: string, hash: string) => Promise<string>;
    cherryPickAbort: (worktreePath: string) => Promise<void>;
    mergeState: (worktreePath: string) => Promise<GitMergeState>;
    // File diff & partial staging
    fileDiff: (worktreePath: string, filePath: string, staged: boolean) => Promise<GitFileDiff>;
    stageHunk: (worktreePath: string, filePath: string, hunkHeader: string) => Promise<void>;
    unstageHunk: (worktreePath: string, filePath: string, hunkHeader: string) => Promise<void>;
    // Blame
    blame: (worktreePath: string, filePath: string) => Promise<GitBlameEntry[]>;
    // Events
    onChanged: (callback: (worktreePath: string) => void) => () => void;
    onLogChanged: (callback: (worktreePath: string) => void) => () => void;
    onPresenceChanged: (
      callback: (worktreePath: string, payload: { isGitRepo: boolean }) => void,
    ) => () => void;
  };
  search: {
    fileContents: (query: string, worktreePath?: string) => Promise<
      Array<{ filePath: string; line: number; preview: string }>
    >;
    sessionContents: (query: string) => Promise<
      Array<{ sessionId: string; filePath: string; lineNumber: number; preview: string }>
    >;
    listSessions: (projectDirs: string[]) => Promise<
      Array<{
        sessionId: string;
        provider: "claude" | "codex";
        projectDir: string;
        filePath: string;
        firstPrompt: string;
        startedAt: string;
        lastActivityAt: string;
        estimatedMessageCount: number;
        fileSize: number;
      }>
    >;
    listSessionsPage: (
      projectDirs: string[],
      options: { limit: number; offset?: number },
    ) => Promise<{
      entries: Array<{
        sessionId: string;
        provider: "claude" | "codex";
        projectDir: string;
        filePath: string;
        firstPrompt: string;
        startedAt: string;
        lastActivityAt: string;
        estimatedMessageCount: number;
        fileSize: number;
      }>;
      total: number;
    }>;
  };
  state: {
    load: () => Promise<PersistedCanvasState | null>;
    save: (state: unknown) => Promise<void>;
  };
  workspace: {
    save: (data: string) => Promise<string | null>;
    open: () => Promise<string | null>;
    saveToPath: (filePath: string, data: string) => Promise<void>;
    setTitle: (title: string) => Promise<void>;
  };
  fs: {
    listDir: (
      dirPath: string,
    ) => Promise<{ name: string; isDirectory: boolean }[]>;
    readFile: (
      filePath: string,
    ) => Promise<
      { type: string; content: string } | { error: string; size?: string }
    >;
    writeFile: (
      filePath: string,
      content: string,
    ) => Promise<{ changed: boolean }>;
    copy: (
      sources: string[],
      destDir: string,
    ) => Promise<{
      copied: string[];
      skipped: string[];
    }>;
    getFilePath: (file: File) => string;
    rename: (oldPath: string, newName: string) => Promise<void>;
    delete: (targetPath: string) => Promise<void>;
    mkdir: (dirPath: string, name: string) => Promise<void>;
    createFile: (dirPath: string, name: string) => Promise<void>;
    reveal: (targetPath: string) => Promise<void>;
    watchDir: (dirPath: string) => Promise<void>;
    unwatchDir: (dirPath: string) => Promise<void>;
    unwatchAllDirs: () => Promise<void>;
    onDirChanged: (callback: (dirPath: string) => void) => () => void;
  };
  memory: {
    scan: (worktreePath: string) => Promise<{
      nodes: Array<{
        fileName: string;
        filePath: string;
        name: string;
        description: string;
        type: string;
        body: string;
        mtime: number;
        ctime: number;
      }>;
      edges: Array<{
        source: string;
        target: string;
        label: string;
      }>;
      dirPath: string;
    }>;
    watch: (worktreePath: string) => Promise<void>;
    unwatch: (worktreePath: string) => Promise<void>;
    onChanged: (
      callback: (graph: {
        nodes: Array<{
          fileName: string;
          filePath: string;
          name: string;
          description: string;
          type: string;
          body: string;
          mtime: number;
          ctime: number;
        }>;
        edges: Array<{
          source: string;
          target: string;
          label: string;
        }>;
        dirPath: string;
      }) => void,
    ) => () => void;
  };
  fonts: {
    getPath: () => Promise<string>;
    listDownloaded: () => Promise<string[]>;
    check: (fileName: string) => Promise<boolean>;
    download: (
      url: string,
      fileName: string,
    ) => Promise<{
      ok: boolean;
      path?: string;
      error?: string;
    }>;
  };
  cli: {
    isRegistered: () => Promise<boolean>;
    register: () => Promise<{ ok: boolean; skillInstalled: boolean }>;
    unregister: () => Promise<boolean>;
    validateCommand: (
      command: string,
      args?: string[],
    ) => Promise<
      | { ok: true; resolvedPath: string; version: string | null }
      | { ok: false; error: string }
    >;
  };
  composer: {
    submit: (request: ComposerSubmitRequest) => Promise<ComposerSubmitResult>;
  };
  usage: {
    query: (dateStr: string) => Promise<UsageSummary>;
    heatmap: () => Promise<Record<string, { tokens: number; cost: number }>>;
  };
  quota: {
    fetch: () => Promise<QuotaFetchResult>;
  };
  codexQuota: {
    fetch: () => Promise<QuotaFetchResult>;
  };
  summary: {
    generate: (input: {
      terminalId: string;
      sessionId: string;
      sessionType: "claude" | "codex";
      cwd: string;
      summaryCli: "claude" | "codex";
      locale: "en" | "zh";
    }) => Promise<{
      ok: boolean;
      summary?: string;
      error?: string;
      sessionFileSize?: number;
    }>;
  };
  insights: {
    generate: (
      cliTool: "claude" | "codex",
      jobId: string,
    ) => Promise<InsightsGenerateResult>;
    onProgress: (
      callback: (progress: InsightsProgressEvent) => void,
    ) => () => void;
    openReport: (filePath: string) => Promise<void>;
    getLastReport: () => Promise<string | null>;
  };
  secure: {
    isAvailable: () => Promise<boolean>;
    encrypt: (plaintext: string) => Promise<string>;
    decrypt: (base64: string) => Promise<string>;
  };
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
    ) => Promise<{ slashCommands: string[] }>;
    send: (
      sessionId: string,
      text: string,
      config: {
        type: "anthropic" | "openai" | "claude-code";
        baseURL: string;
        apiKey: string;
        model: string;
        cwd?: string;
        resumeSessionId?: string;
      },
    ) => Promise<void>;
    abort: (sessionId: string) => Promise<void>;
    clear: (sessionId: string) => Promise<void>;
    delete: (sessionId: string) => Promise<void>;
    approve: (sessionId: string, requestId: string) => Promise<void>;
    deny: (
      sessionId: string,
      requestId: string,
      reason?: string,
    ) => Promise<void>;
    onEvent: (
      callback: (sessionId: string, event: AgentStreamEvent) => void,
    ) => () => void;
  };
  app: {
    homePath: string;
    platform: "darwin" | "win32" | "linux";
    onBeforeClose: (callback: () => void) => () => void;
    requestClose: () => void;
    confirmClose: (options?: { installUpdate?: boolean }) => void;
  };
  hooks: {
    getSocketPath: () => Promise<string | null>;
    getHealth: () => Promise<{
      socketPath: string | null;
      lastEventAt: string | null;
      eventsReceived: number;
      parseErrors: number;
    }>;
    onSessionStarted: (
      callback: (payload: {
        terminalId: string;
        sessionId: string;
        transcriptPath: string | null;
        cwd: string | null;
      }) => void,
    ) => () => void;
    onTurnComplete: (
      callback: (payload: {
        terminalId: string;
        sessionId: string | null;
      }) => void,
    ) => () => void;
    onStopFailure: (
      callback: (payload: {
        terminalId: string;
        sessionId: string | null;
        error: string | null;
        errorDetails: string | null;
      }) => void,
    ) => () => void;
  };
  sessions: {
    onListChanged: (
      callback: (
        sessions: import("../../shared/sessions").SessionInfo[],
      ) => void,
    ) => () => void;
    loadReplay: (
      filePath: string,
    ) => Promise<import("../../shared/sessions").ReplayTimeline>;
  };
  menu: {
    onOpenFolder: (callback: (dirPath: string) => void) => () => void;
    onSelectAll: (callback: () => void) => () => void;
  };
  updater: {
    check: () => Promise<unknown>;
    install: () => void;
    getVersion: () => Promise<string>;
    onUpdateAvailable: (
      callback: (info: UpdateEventInfo) => void,
    ) => () => void;
    onDownloadProgress: (
      callback: (progress: { percent: number }) => void,
    ) => () => void;
    onUpdateDownloaded: (
      callback: (info: UpdateEventInfo) => void,
    ) => () => void;
    onError: (callback: (error: { message: string }) => void) => () => void;
    onLocationWarning?: (
      callback: (info: { bundlePath: string }) => void,
    ) => () => void;
  };
}

export interface UpdateEventInfo {
  version: string;
  releaseNotes: string;
  releaseDate: string;
}

declare global {
  interface Window {
    termcanvas: TermCanvasAPI;
  }
}
