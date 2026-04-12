import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HeadlessApiServer } from "../headless-runtime/api-server.ts";
import { ServerEventBus } from "../headless-runtime/event-bus.ts";
import { ProjectStore, generateId, type ProjectData } from "../headless-runtime/project-store.ts";
import type { ProjectScanner } from "../electron/project-scanner.ts";
import { TelemetryService } from "../electron/telemetry-service.ts";
import {
  WORKFLOW_STATE_SCHEMA_VERSION,
  type WorkflowRecord,
} from "../hydra/src/workflow-store.ts";

type PtyDataListener = (data: string) => void;
type PtyExitListener = (exitCode: number) => void;

export class FakePtyManager {
  readonly creates: Array<{
    cwd: string;
    shell?: string;
    args?: string[];
    terminalId: string;
    terminalType: string;
  }> = [];
  readonly writes: Array<{ ptyId: number; text: string }> = [];
  private readonly dataListeners = new Map<number, PtyDataListener[]>();
  private readonly exitListeners = new Map<number, PtyExitListener[]>();
  private readonly outputs = new Map<number, string[]>();
  private readonly pids = new Map<number, number>();
  private nextPtyId = 1;
  private nextPid = 1000;

  async create(options: {
    cwd: string;
    shell?: string;
    args?: string[];
    terminalId: string;
    terminalType: string;
  }): Promise<number> {
    const ptyId = this.nextPtyId++;
    this.creates.push(options);
    this.dataListeners.set(ptyId, []);
    this.exitListeners.set(ptyId, []);
    this.outputs.set(ptyId, []);
    this.pids.set(ptyId, this.nextPid++);
    return ptyId;
  }

  getPid(ptyId: number): number | null {
    return this.pids.get(ptyId) ?? null;
  }

  onData(ptyId: number, listener: PtyDataListener): void {
    const listeners = this.dataListeners.get(ptyId);
    if (listeners) {
      listeners.push(listener);
    }
  }

  onExit(ptyId: number, listener: PtyExitListener): void {
    const listeners = this.exitListeners.get(ptyId);
    if (listeners) {
      listeners.push(listener);
    }
  }

  captureOutput(ptyId: number, data: string): void {
    const output = this.outputs.get(ptyId);
    if (!output) {
      return;
    }
    output.push(...data.split(/\r?\n/).filter(Boolean));
  }

  getOutput(ptyId: number, lines: number): string[] {
    return (this.outputs.get(ptyId) ?? []).slice(-lines);
  }

  write(ptyId: number, text: string): void {
    this.writes.push({ ptyId, text });
  }

  destroy(ptyId: number): void {
    this.emitExit(ptyId, 0);
  }

  async destroyAll(): Promise<void> {
    for (const ptyId of Array.from(this.exitListeners.keys())) {
      this.emitExit(ptyId, 0);
    }
  }

  emitData(ptyId: number, data: string): void {
    for (const listener of this.dataListeners.get(ptyId) ?? []) {
      listener(data);
    }
  }

  emitExit(ptyId: number, exitCode: number): void {
    const listeners = this.exitListeners.get(ptyId) ?? [];
    for (const listener of listeners) {
      listener(exitCode);
    }
    this.dataListeners.delete(ptyId);
    this.exitListeners.delete(ptyId);
    this.outputs.delete(ptyId);
    this.pids.delete(ptyId);
  }
}

export function createWorkspaceFixture(
  files: Record<string, string>,
): string {
  const workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "termcanvas-headless-workspace-"),
  );

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(workspaceDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
  }

  return workspaceDir;
}

export function calculateDirectorySizeSync(rootDir: string): number {
  const stat = fs.lstatSync(rootDir);
  if (!stat.isDirectory()) {
    return stat.size;
  }

  let total = 0;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      total += calculateDirectorySizeSync(entryPath);
      continue;
    }
    total += fs.lstatSync(entryPath).size;
  }
  return total;
}

export function addProjectWithMainWorktree(
  store: ProjectStore,
  repoPath: string,
  name = "repo",
): { projectId: string; worktreeId: string } {
  const projectId = generateId();
  const worktreeId = generateId();
  const project: ProjectData = {
    id: projectId,
    name,
    path: repoPath,
    position: { x: 0, y: 0 },
    collapsed: false,
    zIndex: 0,
    worktrees: [
      {
        id: worktreeId,
        name: "main",
        path: repoPath,
        position: { x: 0, y: 0 },
        collapsed: false,
        terminals: [],
      },
    ],
  };
  store.addProject(project);
  return { projectId, worktreeId };
}

export function writeWorkflowFixture(
  repoPath: string,
  overrides: Partial<WorkflowRecord> = {},
): WorkflowRecord {
  const workflowId = overrides.id ?? `workflow-${generateId()}`;
  const workflowDir = path.join(repoPath, ".hydra", "workflows", workflowId);
  fs.mkdirSync(workflowDir, { recursive: true });

  const workflow: WorkflowRecord = {
    schema_version: WORKFLOW_STATE_SCHEMA_VERSION,
    id: workflowId,
    lead_terminal_id: "terminal-test-helper",
    intent_file: "inputs/intent.md",
    repo_path: repoPath,
    worktree_path: repoPath,
    branch: null,
    base_branch: "main",
    own_worktree: false,
    created_at: "2026-03-31T00:00:00.000Z",
    updated_at: "2026-03-31T00:00:00.000Z",
    status: "active",
    nodes: {},
    node_statuses: {},
    assignment_ids: ["assignment-test"],
    default_timeout_minutes: 15,
    default_max_retries: 3,
    default_agent_type: "claude",
    auto_approve: false,
    ...overrides,
  };

  fs.writeFileSync(
    path.join(workflowDir, "workflow.json"),
    JSON.stringify(workflow, null, 2),
    "utf-8",
  );

  return workflow;
}

export async function startHeadlessServer(options: {
  workspaceDir: string;
  projectStore?: ProjectStore;
  eventBus?: ServerEventBus;
  telemetryService?: TelemetryService;
  ptyManager?: FakePtyManager;
  projectScanner?: Pick<ProjectScanner, "scan" | "listWorktrees">;
  serverVersion?: string;
  rateLimit?: number;
  corsOrigins?: string[];
}): Promise<{
  server: HeadlessApiServer;
  port: number;
  baseUrl: string;
  projectStore: ProjectStore;
  eventBus: ServerEventBus;
  telemetryService: TelemetryService;
  ptyManager: FakePtyManager;
}> {
  const projectStore = options.projectStore ?? new ProjectStore();
  const eventBus = options.eventBus ?? new ServerEventBus();
  const telemetryService = options.telemetryService ?? new TelemetryService({
    processPollIntervalMs: 0,
    sessionPollIntervalMs: 0,
  });
  const ptyManager = options.ptyManager ?? new FakePtyManager();

  const server = new HeadlessApiServer({
    projectStore,
    ptyManager: ptyManager as never,
    projectScanner: options.projectScanner ?? {
      scan: () => null,
      listWorktrees: () => [],
    } as never,
    telemetryService,
    eventBus,
    workspaceDir: options.workspaceDir,
    rateLimit: options.rateLimit,
    corsOrigins: options.corsOrigins,
    serverVersion: options.serverVersion,
  });

  const port = await server.start(0, "127.0.0.1");

  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    projectStore,
    eventBus,
    telemetryService,
    ptyManager,
  };
}

export async function stopHeadlessServer(input: {
  server: HeadlessApiServer;
  telemetryService: TelemetryService;
}): Promise<void> {
  input.server.stop();
  input.telemetryService.dispose();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
