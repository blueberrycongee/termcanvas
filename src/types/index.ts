import type { SceneDocument } from "./scene";
import type {
  TelemetryEventPage,
  TerminalTelemetrySnapshot,
  WorkflowTelemetrySnapshot,
} from "../../shared/telemetry";

export * from "./scene";

export type TerminalType =
  | "shell"
  | "claude"
  | "codex"
  | "kimi"
  | "gemini"
  | "opencode"
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
  span: { cols: number; rows: number };
  origin?: TerminalOrigin;
  parentTerminalId?: string;
  scrollback?: string;
  sessionId?: string;
  initialPrompt?: string;
  autoApprove?: boolean;
  stashed?: boolean;
  stashedAt?: number;
}

export interface StashedTerminal {
  terminal: TerminalData;
  projectId: string;
  worktreeId: string;
  stashedAt: number;
}

export interface WorktreeData {
  id: string;
  name: string;
  path: string;
  position: Position;
  collapsed: boolean;
  terminals: TerminalData[];
}

export interface ProjectData {
  id: string;
  name: string;
  path: string;
  position: Position;
  collapsed: boolean;
  zIndex: number;
  worktrees: WorktreeData[];
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

// Usage statistics types
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
export type HydraInstructionStatus = "created" | "appended" | "updated" | "unchanged";

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

// Agent stream event — subset of AgentEvent serializable across IPC
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
  | { type: "message_start"; usage?: { input_tokens: number; output_tokens: number } }
  | { type: "message_delta"; stop_reason: string | null };

// Preload API types
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
    detectCli: (ptyId: number) => Promise<{ cliType: TerminalType; pid?: number; sessionName?: string; autoApprove?: boolean } | null>;
  };
  session: {
    getCodexLatest: () => Promise<string | null>;
    findCodex: (
      cwd: string,
      startedAt?: string,
    ) => Promise<{ sessionId: string; filePath: string; confidence: "medium" | "weak" } | null>;
    findClaude: (
      cwd: string,
      startedAt?: string,
      pid?: number | null,
    ) => Promise<{ sessionId: string; filePath: string; confidence: "strong" | "medium" | "weak" } | null>;
    getPermissionMode: (sessionId: string, cwd: string) => Promise<string | null>;
    getBypassState: (type: string, sessionId: string, cwd: string) => Promise<boolean>;
    getClaudeByPid: (pid: number) => Promise<string | null>;
    getKimiLatest: (cwd: string) => Promise<string | null>;
    watch: (type: string, sessionId: string, cwd: string) => Promise<{ ok: boolean; reason?: string }>;
    unwatch: (sessionId: string) => Promise<void>;
    onTurnComplete: (callback: (sessionId: string) => void) => () => void;
  };
  telemetry: {
    attachSession: (input: {
      terminalId: string;
      provider: "claude" | "codex";
      sessionId: string;
      cwd: string;
      confidence: "strong" | "medium" | "weak";
    }) => Promise<{ ok: boolean; sessionFile: string | null }>;
    detachSession: (terminalId: string) => Promise<void>;
    updateTerminal: (input: {
      terminalId: string;
      worktreePath?: string;
      provider?: "claude" | "codex" | "unknown";
      ptyId?: number | null;
      shellPid?: number | null;
    }) => Promise<TerminalTelemetrySnapshot>;
    getTerminal: (terminalId: string) => Promise<TerminalTelemetrySnapshot | null>;
    getWorkflow: (workflowId: string, repoPath: string) => Promise<WorkflowTelemetrySnapshot | null>;
    listEvents: (input: { terminalId: string; limit?: number; cursor?: string }) => Promise<TelemetryEventPage>;
  };
  project: {
    selectDirectory: () => Promise<string | null>;
    scan: (dirPath: string) => Promise<{
      name: string;
      path: string;
      worktrees: { path: string; branch: string; isMain: boolean }[];
    } | null>;
    rescanWorktrees: (
      dirPath: string,
    ) => Promise<{ path: string; branch: string; isMain: boolean }[]>;
    enableHydra: (dirPath: string) => Promise<ProjectEnableHydraResult>;
    checkHydra: (dirPath: string) => Promise<"missing" | "outdated" | "current">;
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
    commitDetail: (worktreePath: string, hash: string) => Promise<GitCommitDetail | null>;
    checkout: (worktreePath: string, ref: string) => Promise<void>;
    init: (worktreePath: string) => Promise<void>;
    status: (worktreePath: string) => Promise<GitStatusEntry[]>;
    stage: (worktreePath: string, paths: string[]) => Promise<void>;
    unstage: (worktreePath: string, paths: string[]) => Promise<void>;
    discard: (worktreePath: string, trackedPaths: string[], untrackedPaths: string[]) => Promise<void>;
    commit: (worktreePath: string, message: string) => Promise<string>;
    push: (worktreePath: string) => Promise<string>;
    pull: (worktreePath: string) => Promise<string>;
    onChanged: (callback: (worktreePath: string) => void) => () => void;
    onLogChanged: (callback: (worktreePath: string) => void) => () => void;
    onPresenceChanged: (
      callback: (worktreePath: string, payload: { isGitRepo: boolean }) => void,
    ) => () => void;
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
    listDir: (dirPath: string) => Promise<{ name: string; isDirectory: boolean }[]>;
    readFile: (filePath: string) => Promise<
      | { type: string; content: string }
      | { error: string; size?: string }
    >;
    writeFile: (filePath: string, content: string) => Promise<{ changed: boolean }>;
    copy: (sources: string[], destDir: string) => Promise<{
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
    onChanged: (callback: (graph: {
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
    }) => void) => () => void;
  };
  fonts: {
    getPath: () => Promise<string>;
    listDownloaded: () => Promise<string[]>;
    check: (fileName: string) => Promise<boolean>;
    download: (url: string, fileName: string) => Promise<{
      ok: boolean;
      path?: string;
      error?: string;
    }>;
  };
  cli: {
    isRegistered: () => Promise<boolean>;
    register: () => Promise<boolean>;
    unregister: () => Promise<boolean>;
    validateCommand: (command: string, args?: string[]) => Promise<
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
    }) => Promise<{ ok: boolean; summary?: string; error?: string; sessionFileSize?: number }>;
  };
  insights: {
    generate: (
      cliTool: "claude" | "codex",
      jobId: string,
    ) => Promise<InsightsGenerateResult>;
    onProgress: (callback: (progress: InsightsProgressEvent) => void) => () => void;
    openReport: (filePath: string) => Promise<void>;
    getLastReport: () => Promise<string | null>;
  };
  agent: {
    send: (sessionId: string, text: string, config: { provider: "anthropic"; apiKey: string; model: string }) => Promise<void>;
    abort: (sessionId: string) => Promise<void>;
    clear: (sessionId: string) => Promise<void>;
    delete: (sessionId: string) => Promise<void>;
    onEvent: (callback: (sessionId: string, event: AgentStreamEvent) => void) => () => void;
  };
  app: {
    platform: "darwin" | "win32" | "linux";
    onBeforeClose: (callback: () => void) => () => void;
    requestClose: () => void;
    confirmClose: (options?: { installUpdate?: boolean }) => void;
  };
  menu: {
    onOpenFolder: (callback: (dirPath: string) => void) => () => void;
  };
  updater: {
    check: () => Promise<unknown>;
    install: () => void;
    getVersion: () => Promise<string>;
    onUpdateAvailable: (callback: (info: UpdateEventInfo) => void) => () => void;
    onDownloadProgress: (callback: (progress: { percent: number }) => void) => () => void;
    onUpdateDownloaded: (callback: (info: UpdateEventInfo) => void) => () => void;
    onError: (callback: (error: { message: string }) => void) => () => void;
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
