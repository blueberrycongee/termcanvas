/**
 * Headless API server — replaces electron/api-server.ts without Electron dependencies.
 * All execRenderer calls are replaced with direct ProjectStore method calls.
 * Same HTTP API contract (routes, request/response shapes) as the Electron version.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { ProjectStore } from "./project-store.ts";
import type { PtyManager } from "../electron/pty-manager.ts";
import type { ProjectScanner } from "../electron/project-scanner.ts";
import { getApiDiff } from "../electron/git-diff.ts";
import type { TelemetryService } from "../electron/telemetry-service.ts";
import type { TerminalType } from "./project-store.ts";
import type { ServerEventBus } from "./event-bus.ts";
import { ensureProjectTracked, rescanTrackedProject } from "./project-sync.ts";
import { createWorktreeControl, type WorktreeControl } from "./worktree-control.ts";
import { createWorkflowControl, type WorkflowControl } from "./workflow-control.ts";
import { destroyTrackedTerminal, launchTrackedTerminal } from "./terminal-launch.ts";
import { listActiveWorkflowSummaries } from "./workflow-status.ts";

interface HeadlessApiServerDeps {
  projectStore: ProjectStore;
  ptyManager: PtyManager;
  projectScanner: ProjectScanner;
  telemetryService: TelemetryService;
  eventBus?: ServerEventBus;
  workspaceDir?: string;
  onMutation?: () => void;
  rateLimit?: number;
  corsOrigins?: string[];
  serverVersion?: string;
  workflowControl?: WorkflowControl;
  worktreeControl?: WorktreeControl;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const CREDENTIAL_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "TERMCANVAS_API_TOKEN",
] as const;

export class HeadlessApiServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly deps: HeadlessApiServerDeps;
  private readonly startedAt = Date.now();
  private readonly apiToken: string | undefined;
  private readonly rateLimit: number;
  private readonly rateLimitMap = new Map<string, RateLimitEntry>();
  private rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly corsOrigins: string[];
  private readonly serverVersion: string;
  private ready = false;
  private diskUsageBytes: number | null = null;
  private diskUsageTimer: ReturnType<typeof setInterval> | null = null;
  private diskUsageRefresh: Promise<number> | null = null;
  private sseConnectionCount = 0;
  private static readonly MAX_SSE_CONNECTIONS = 50;
  private boundHost = "127.0.0.1";
  private boundPort = 0;
  private readonly workflowControl: WorkflowControl;
  private readonly worktreeControl: WorktreeControl;

  constructor(deps: HeadlessApiServerDeps) {
    this.deps = deps;
    this.apiToken = process.env.TERMCANVAS_API_TOKEN?.trim() || undefined;
    this.rateLimit = deps.rateLimit ?? 0;
    this.corsOrigins = deps.corsOrigins ?? [];
    this.serverVersion = deps.serverVersion ?? "0.0.0";
    this.workflowControl = deps.workflowControl ?? createWorkflowControl({
      projectStore: deps.projectStore,
      ptyManager: deps.ptyManager,
      telemetryService: deps.telemetryService,
      projectScanner: deps.projectScanner,
      eventBus: deps.eventBus,
      onMutation: deps.onMutation,
    });
    this.worktreeControl = deps.worktreeControl ?? createWorktreeControl({
      projectStore: deps.projectStore,
      projectScanner: deps.projectScanner,
      onMutation: deps.onMutation,
    });
  }

  start(port = 0, host = "127.0.0.1"): Promise<number> {
    if (this.rateLimit > 0) {
      this.rateLimitCleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [ip, entry] of this.rateLimitMap) {
          if (entry.resetAt < now) this.rateLimitMap.delete(ip);
        }
      }, 60_000);
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) =>
        this.handleRequest(req, res),
      );

      this.wss = new WebSocketServer({ noServer: true });

      this.server.on("upgrade", (request, socket, head) => {
        const url = new URL(
          request.url ?? "/",
          `http://${request.headers.host}`,
        );

        if (url.pathname === "/pty/stream") {
          if (this.apiToken) {
            const authHeader = request.headers["authorization"];
            if (authHeader !== `Bearer ${this.apiToken}`) {
              socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
              socket.destroy();
              return;
            }
          }
          this.wss!.handleUpgrade(request, socket, head, (ws) => {
            this.handlePtyWebSocket(ws, url);
          });
        } else {
          socket.destroy();
        }
      });

      this.server.listen(port, host, () => {
        const addr = this.server!.address();
        const resolved = typeof addr === "object" && addr ? addr.port : 0;
        this.ready = true;
        this.boundHost = host;
        this.boundPort = resolved;
        void this.startDiskUsagePolling().then(() => resolve(resolved), reject);
      });
      this.server.on("error", reject);
    });
  }

  stop(): void {
    this.ready = false;
    if (this.rateLimitCleanupTimer) {
      clearInterval(this.rateLimitCleanupTimer);
      this.rateLimitCleanupTimer = null;
    }
    if (this.diskUsageTimer) {
      clearInterval(this.diskUsageTimer);
      this.diskUsageTimer = null;
    }
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
    }
    this.server?.close();
    this.server = null;
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const start = Date.now();
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const method = req.method ?? "GET";
    const pathname = url.pathname;

    res.setHeader("Content-Type", "application/json");

    if (this.corsOrigins.length > 0) {
      const origin = req.headers.origin;
      if (origin && this.corsOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET,POST,PUT,DELETE,OPTIONS",
        );
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Authorization,Content-Type",
        );
        res.setHeader("Access-Control-Max-Age", "86400");
      }
    }

    if (method === "OPTIONS") {
      const statusCode = req.headers.origin &&
        this.corsOrigins.includes(req.headers.origin) ? 204 : 404;
      res.writeHead(statusCode);
      res.end();
      this.logRequest(method, pathname, statusCode, start);
      return;
    }

    // Health endpoints are always public (no auth required)
    if (method === "GET" && pathname === "/health") {
      const terminals = this.deps.projectStore.listTerminals();
      const activeWorkflows = this.getActiveWorkflows();
      const mem = process.memoryUsage();
      const statusCounts: Record<string, number> = {};
      for (const t of terminals) {
        statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
      }
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: "ok",
          version: this.serverVersion,
          uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1000),
          node_version: process.version,
          platform: process.platform,
          active_terminals: terminals.length,
          active_workflows: activeWorkflows.length,
          terminal_status_summary: statusCounts,
          memory: {
            rss_bytes: mem.rss,
            heap_used_bytes: mem.heapUsed,
            heap_total_bytes: mem.heapTotal,
          },
          disk_usage_bytes: this.diskUsageBytes,
        }),
      );
      this.logRequest(method, pathname, 200, start);
      return;
    }

    if (method === "GET" && pathname === "/health/live") {
      res.writeHead(200);
      res.end(JSON.stringify({ status: "ok" }));
      this.logRequest(method, pathname, 200, start);
      return;
    }

    if (method === "GET" && pathname === "/health/ready") {
      const code = this.ready ? 200 : 503;
      res.writeHead(code);
      res.end(JSON.stringify({ ready: this.ready }));
      this.logRequest(method, pathname, code, start);
      return;
    }

    if (this.rateLimit > 0) {
      const ip = req.socket.remoteAddress ?? "unknown";
      const now = Date.now();
      let entry = this.rateLimitMap.get(ip);
      if (!entry || entry.resetAt < now) {
        entry = { count: 0, resetAt: now + 60_000 };
        this.rateLimitMap.set(ip, entry);
      }
      entry.count++;
      if (entry.count > this.rateLimit) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        res.setHeader("Retry-After", String(retryAfter));
        res.writeHead(429);
        res.end(JSON.stringify({ error: "Too many requests" }));
        this.logRequest(method, pathname, 429, start);
        return;
      }
    }

    if (this.apiToken) {
      const authHeader = req.headers["authorization"];
      if (authHeader !== `Bearer ${this.apiToken}`) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: "Unauthorized" }));
        this.logRequest(method, pathname, 401, start);
        return;
      }
    }

    // SSE endpoint — handled separately from JSON routes
    const sseMatch = method === "GET" && pathname.match(/^\/api\/terminal\/([^/]+)\/events$/);
    if (sseMatch) {
      this.handleSSE(sseMatch[1], res);
      this.logRequest(method, pathname, 200, start);
      return;
    }

    try {
      const body =
        method === "POST" || method === "PUT" || method === "DELETE"
          ? await this.readBody(req)
          : null;
      const result = await this.route(method, pathname, url, body);
      res.writeHead(200);
      res.end(JSON.stringify(result));
      this.logRequest(method, pathname, 200, start);
    } catch (err: unknown) {
      const status =
        err instanceof Object && "status" in err
          ? (err as { status: number }).status
          : 500;
      const message =
        err instanceof Error ? err.message : "Internal error";
      res.writeHead(status);
      res.end(JSON.stringify({ error: this.sanitizeErrorMessage(message) }));
      this.logRequest(method, pathname, status, start);
    }
  }

  private logRequest(
    method: string,
    pathname: string,
    status: number,
    startTime: number,
  ): void {
    const duration = Date.now() - startTime;
    console.log(`[api] ${method} ${pathname} ${status} ${duration}ms`);
  }

  private sanitizeErrorMessage(message: string): string {
    let sanitized = message;
    for (const key of CREDENTIAL_ENV_KEYS) {
      const value = process.env[key]?.trim();
      if (value && value.length >= 8) {
        sanitized = sanitized.replaceAll(value, "[REDACTED]");
      }
    }
    return sanitized;
  }

  private async route(
    method: string,
    pathname: string,
    url: URL,
    body: unknown,
  ): Promise<unknown> {
    if (method === "POST" && pathname === "/project/add") {
      return this.projectAdd(body);
    }
    if (method === "GET" && pathname === "/project/list") {
      return this.projectList();
    }
    if (method === "DELETE" && pathname.match(/^\/project\/[^/]+$/)) {
      const id = pathname.split("/")[2];
      return this.projectRemove(id);
    }
    if (method === "POST" && pathname.match(/^\/project\/[^/]+\/rescan$/)) {
      const id = pathname.split("/")[2];
      return this.projectRescan(id);
    }

    if (method === "POST" && pathname === "/workflow/run") {
      return this.workflowRun(body);
    }
    if (method === "GET" && pathname === "/workflow/list") {
      const repoPath = url.searchParams.get("repo");
      return this.workflowList(repoPath);
    }
    if (method === "GET" && pathname.match(/^\/workflow\/[^/]+$/)) {
      const id = pathname.split("/")[2];
      const repoPath = url.searchParams.get("repo");
      return this.workflowStatus(id, repoPath);
    }
    if (method === "POST" && pathname.match(/^\/workflow\/[^/]+\/tick$/)) {
      const id = pathname.split("/")[2];
      return this.workflowTick(id, body);
    }
    if (method === "POST" && pathname.match(/^\/workflow\/[^/]+\/retry$/)) {
      const id = pathname.split("/")[2];
      return this.workflowRetry(id, body);
    }
    if (method === "DELETE" && pathname.match(/^\/workflow\/[^/]+$/)) {
      const id = pathname.split("/")[2];
      return this.workflowCleanup(id, url);
    }

    if (method === "GET" && pathname === "/worktree/list") {
      const repoPath = url.searchParams.get("repo");
      return this.worktreeList(repoPath);
    }
    if (method === "POST" && pathname === "/worktree/create") {
      return this.worktreeCreate(body);
    }
    if (method === "DELETE" && pathname === "/worktree") {
      return this.worktreeRemove(url);
    }

    if (method === "POST" && pathname === "/terminal/create") {
      return this.terminalCreate(body);
    }
    if (method === "GET" && pathname === "/terminal/list") {
      const worktree = url.searchParams.get("worktree");
      return this.terminalList(worktree);
    }
    if (method === "POST" && pathname.match(/^\/terminal\/[^/]+\/input$/)) {
      const id = pathname.split("/")[2];
      return this.terminalInput(id, body);
    }
    if (method === "GET" && pathname.match(/^\/terminal\/[^/]+\/status$/)) {
      const id = pathname.split("/")[2];
      return this.terminalStatus(id);
    }
    if (method === "GET" && pathname.match(/^\/terminal\/[^/]+\/output$/)) {
      const id = pathname.split("/")[2];
      const lines = parseInt(url.searchParams.get("lines") ?? "50", 10);
      return this.terminalOutput(id, lines);
    }
    if (method === "DELETE" && pathname.match(/^\/terminal\/[^/]+$/)) {
      const id = pathname.split("/")[2];
      return this.terminalDestroy(id);
    }
    if (
      method === "PUT" &&
      pathname.match(/^\/terminal\/[^/]+\/custom-title$/)
    ) {
      const id = pathname.split("/")[2];
      return this.terminalSetCustomTitle(id, body);
    }

    // Telemetry endpoints
    if (
      method === "GET" &&
      pathname.match(/^\/telemetry\/terminal\/[^/]+$/)
    ) {
      const id = pathname.split("/")[3];
      return this.terminalTelemetry(id);
    }
    if (
      method === "GET" &&
      pathname.match(/^\/telemetry\/terminal\/[^/]+\/events$/)
    ) {
      const id = pathname.split("/")[3];
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
      const cursor = url.searchParams.get("cursor") ?? undefined;
      return this.terminalTelemetryEvents(id, limit, cursor);
    }
    if (
      method === "GET" &&
      pathname.match(/^\/telemetry\/workflow\/[^/]+$/)
    ) {
      const id = pathname.split("/")[3];
      const repoPath = url.searchParams.get("repo");
      return this.workflowTelemetry(id, repoPath);
    }

    if (method === "GET" && pathname.startsWith("/diff/")) {
      const worktreePath = decodeURIComponent(
        pathname.slice("/diff/".length),
      );
      const summary = url.searchParams.has("summary");
      return this.getDiff(worktreePath, summary);
    }

    if (method === "GET" && pathname === "/api/memory/index") {
      const worktree = url.searchParams.get("worktree");
      return this.memoryIndex(worktree);
    }

    if (method === "GET" && pathname === "/api/status") {
      return this.getServerStatus();
    }

    if (method === "GET" && pathname === "/state") {
      return this.getState();
    }

    throw Object.assign(new Error("Not found"), { status: 404 });
  }

  private readBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: string) => (data += chunk));
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
        }
      });
      req.on("error", reject);
    });
  }

  private projectAdd(body: unknown): {
    id: string;
    name: string;
    worktrees: number;
  } {
    const { path: dirPath } = body as { path?: string };
    if (!dirPath) {
      throw Object.assign(new Error("path is required"), { status: 400 });
    }

    const tracked = ensureProjectTracked({
      projectStore: this.deps.projectStore,
      projectScanner: this.deps.projectScanner,
      repoPath: dirPath,
      onMutation: this.deps.onMutation,
    });

    return {
      id: tracked.project.id,
      name: tracked.project.name,
      worktrees: tracked.worktrees,
    };
  }

  private projectList(): unknown {
    const projects = this.deps.projectStore.getProjects();
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      path: p.path,
      worktrees: p.worktrees.map((w) => ({
        id: w.id,
        name: w.name,
        path: w.path,
        terminals: w.terminals.map((t) => ({
          id: t.id,
          title: t.title,
          customTitle: t.customTitle,
          starred: t.starred,
          type: t.type,
          status: t.status,
          ptyId: t.ptyId,
          span: t.span,
          parentTerminalId: t.parentTerminalId,
        })),
      })),
    }));
  }

  private projectRemove(id: string): { ok: boolean } {
    this.deps.projectStore.removeProject(id);
    this.deps.onMutation?.();
    return { ok: true };
  }

  private projectRescan(projectId: string): {
    ok: boolean;
    worktrees: number;
  } {
    const result = rescanTrackedProject({
      projectStore: this.deps.projectStore,
      projectScanner: this.deps.projectScanner,
      projectId,
      onMutation: this.deps.onMutation,
    });
    return { ok: true, worktrees: result.worktrees };
  }

  private workflowRun(body: unknown): Promise<unknown> {
    const {
      task,
      repo,
      repoPath,
      worktree,
      worktreePath,
      template,
      allType,
      researcherType,
      implementerType,
      testerType,
      timeoutMinutes,
      maxRetries,
      autoApprove,
    } = body as {
      task?: string;
      repo?: string;
      repoPath?: string;
      worktree?: string;
      worktreePath?: string;
      template?: "single-step" | "researcher-implementer-tester";
      allType?: "claude" | "codex" | "kimi" | "gemini";
      researcherType?: "claude" | "codex" | "kimi" | "gemini";
      implementerType?: "claude" | "codex" | "kimi" | "gemini";
      testerType?: "claude" | "codex" | "kimi" | "gemini";
      timeoutMinutes?: number;
      maxRetries?: number;
      autoApprove?: boolean;
    };

    if (!task) {
      throw Object.assign(new Error("task is required"), { status: 400 });
    }
    const resolvedRepo = repoPath ?? repo;
    if (!resolvedRepo) {
      throw Object.assign(new Error("repo is required"), { status: 400 });
    }

    return this.workflowControl.run({
      task,
      repoPath: resolvedRepo,
      worktreePath: worktreePath ?? worktree,
      template,
      allType,
      researcherType,
      implementerType,
      testerType,
      timeoutMinutes,
      maxRetries,
      autoApprove,
    });
  }

  private workflowList(repoPath: string | null): unknown {
    if (!repoPath) {
      throw Object.assign(new Error("repo query parameter is required"), {
        status: 400,
      });
    }
    return this.workflowControl.list(repoPath);
  }

  private workflowStatus(workflowId: string, repoPath: string | null): unknown {
    if (!repoPath) {
      throw Object.assign(new Error("repo query parameter is required"), {
        status: 400,
      });
    }
    return this.workflowControl.status(repoPath, workflowId);
  }

  private workflowTick(workflowId: string, body: unknown): Promise<unknown> {
    const { repo, repoPath } = body as { repo?: string; repoPath?: string };
    const resolvedRepo = repoPath ?? repo;
    if (!resolvedRepo) {
      throw Object.assign(new Error("repo is required"), { status: 400 });
    }
    return this.workflowControl.tick(resolvedRepo, workflowId);
  }

  private workflowRetry(workflowId: string, body: unknown): Promise<unknown> {
    const { repo, repoPath } = body as { repo?: string; repoPath?: string };
    const resolvedRepo = repoPath ?? repo;
    if (!resolvedRepo) {
      throw Object.assign(new Error("repo is required"), { status: 400 });
    }
    return this.workflowControl.retry(resolvedRepo, workflowId);
  }

  private workflowCleanup(workflowId: string, url: URL): unknown {
    const repoPath = url.searchParams.get("repo");
    if (!repoPath) {
      throw Object.assign(new Error("repo query parameter is required"), {
        status: 400,
      });
    }
    const force = url.searchParams.get("force");
    return this.workflowControl.cleanup(
      repoPath,
      workflowId,
      force === "1" || force === "true",
    );
  }

  private worktreeList(repoPath: string | null): unknown {
    if (!repoPath) {
      throw Object.assign(new Error("repo query parameter is required"), {
        status: 400,
      });
    }
    return this.worktreeControl.list(repoPath);
  }

  private worktreeCreate(body: unknown): unknown {
    const {
      repo,
      repoPath,
      branch,
      path: requestedPath,
      worktreePath,
      baseBranch,
    } = body as {
      repo?: string;
      repoPath?: string;
      branch?: string;
      path?: string;
      worktreePath?: string;
      baseBranch?: string;
    };
    const resolvedRepo = repoPath ?? repo;
    if (!resolvedRepo) {
      throw Object.assign(new Error("repo is required"), { status: 400 });
    }
    if (!branch) {
      throw Object.assign(new Error("branch is required"), { status: 400 });
    }
    return this.worktreeControl.create({
      repoPath: resolvedRepo,
      branch,
      worktreePath: worktreePath ?? requestedPath,
      baseBranch,
    });
  }

  private worktreeRemove(url: URL): unknown {
    const repoPath = url.searchParams.get("repo");
    const worktreePath = url.searchParams.get("path");
    if (!repoPath) {
      throw Object.assign(new Error("repo query parameter is required"), {
        status: 400,
      });
    }
    if (!worktreePath) {
      throw Object.assign(new Error("path query parameter is required"), {
        status: 400,
      });
    }
    const force = url.searchParams.get("force");
    return this.worktreeControl.remove({
      repoPath,
      worktreePath,
      force: force === "1" || force === "true",
    });
  }

  private async terminalCreate(body: unknown): Promise<{
    id: string;
    type: string;
    title: string;
  }> {
    const {
      worktree,
      type = "shell",
      prompt,
      autoApprove,
      parentTerminalId,
      workflowId,
      assignmentId,
      repoPath,
    } = body as {
      worktree?: string;
      type?: string;
      prompt?: string;
      autoApprove?: boolean;
      parentTerminalId?: string;
      workflowId?: string;
      assignmentId?: string;
      repoPath?: string;
    };

    if (!worktree) {
      throw Object.assign(new Error("worktree path is required"), {
        status: 400,
      });
    }

    const terminal = await launchTrackedTerminal({
      projectStore: this.deps.projectStore,
      ptyManager: this.deps.ptyManager,
      telemetryService: this.deps.telemetryService,
      eventBus: this.deps.eventBus,
      onMutation: this.deps.onMutation,
      worktree,
      type: type as TerminalType,
      prompt,
      autoApprove,
      parentTerminalId,
      workflowId,
      assignmentId,
      repoPath,
    });

    return { id: terminal.id, type: terminal.type, title: terminal.title };
  }

  private terminalList(
    worktreePath: string | null,
  ): unknown {
    return this.deps.projectStore.listTerminals(worktreePath);
  }

  private terminalInput(
    terminalId: string,
    body: unknown,
  ): { ok: boolean } {
    const { text } = body as { text?: string };
    if (!text) {
      throw Object.assign(new Error("text is required"), { status: 400 });
    }

    const terminal = this.deps.projectStore.getTerminal(terminalId);
    if (!terminal) {
      throw Object.assign(new Error("Terminal not found"), { status: 404 });
    }
    if (!terminal.ptyId) {
      throw Object.assign(new Error("Terminal has no active PTY"), {
        status: 409,
      });
    }

    this.deps.ptyManager.write(terminal.ptyId, text);
    return { ok: true };
  }

  private terminalStatus(
    terminalId: string,
  ): { id: string; status: string; ptyId: number | null } {
    const terminal = this.deps.projectStore.getTerminal(terminalId);
    if (!terminal) {
      throw Object.assign(new Error("Terminal not found"), { status: 404 });
    }
    return {
      id: terminal.id,
      status: terminal.status,
      ptyId: terminal.ptyId,
    };
  }

  private terminalOutput(
    terminalId: string,
    lines: number,
  ): { id: string; lines: string[] } {
    const terminal = this.deps.projectStore.getTerminal(terminalId);
    if (!terminal) {
      throw Object.assign(new Error("Terminal not found"), { status: 404 });
    }
    if (!terminal.ptyId) return { id: terminalId, lines: [] };
    const output = this.deps.ptyManager.getOutput(terminal.ptyId, lines);
    return { id: terminalId, lines: output };
  }

  private terminalDestroy(terminalId: string): { ok: boolean } {
    return destroyTrackedTerminal({
      projectStore: this.deps.projectStore,
      ptyManager: this.deps.ptyManager,
      telemetryService: this.deps.telemetryService,
      eventBus: this.deps.eventBus,
      onMutation: this.deps.onMutation,
      terminalId,
    });
  }

  private terminalSetCustomTitle(
    terminalId: string,
    body: unknown,
  ): { ok: boolean } {
    const { customTitle } = body as { customTitle?: string };
    if (typeof customTitle !== "string") {
      throw Object.assign(new Error("customTitle is required"), {
        status: 400,
      });
    }

    const found = this.deps.projectStore.setCustomTitle(
      terminalId,
      customTitle,
    );
    if (!found) {
      throw Object.assign(new Error("Terminal not found"), { status: 404 });
    }
    this.deps.onMutation?.();
    return { ok: true };
  }

  private terminalTelemetry(terminalId: string): unknown {
    const snapshot =
      this.deps.telemetryService.getTerminalSnapshot(terminalId);
    if (!snapshot) {
      throw Object.assign(new Error("Telemetry terminal not found"), {
        status: 404,
      });
    }
    return snapshot;
  }

  private terminalTelemetryEvents(
    terminalId: string,
    limit: number,
    cursor?: string,
  ): unknown {
    return this.deps.telemetryService.listTerminalEvents({
      terminalId,
      limit,
      cursor,
    });
  }

  private workflowTelemetry(
    workflowId: string,
    repoPath: string | null,
  ): unknown {
    if (!repoPath) {
      throw Object.assign(
        new Error("repo query parameter is required"),
        { status: 400 },
      );
    }
    const snapshot = this.deps.telemetryService.getWorkflowSnapshot(
      repoPath,
      workflowId,
    );
    if (!snapshot) {
      throw Object.assign(new Error("Workflow telemetry not found"), {
        status: 404,
      });
    }
    return snapshot;
  }

  private async memoryIndex(worktree: string | null): Promise<unknown> {
    if (!worktree) {
      throw Object.assign(
        new Error("worktree query parameter is required"),
        { status: 400 },
      );
    }
    const { getMemoryDirForWorktree, scanMemoryDir } = await import(
      "../electron/memory-service.js"
    );
    const { generateEnhancedIndex } = await import(
      "../electron/memory-index-generator.js"
    );
    const memDir = getMemoryDirForWorktree(worktree);
    const graph = scanMemoryDir(memDir);
    const index = generateEnhancedIndex(graph.nodes);
    return { index };
  }

  private async getDiff(
    worktreePath: string,
    summary: boolean,
  ): Promise<unknown> {
    try {
      if (summary) {
        return await getApiDiff(worktreePath, true);
      }
      return await getApiDiff(worktreePath, false);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      throw Object.assign(new Error(`Failed to get diff: ${message}`), {
        status: 400,
      });
    }
  }

  private getState(): unknown {
    return this.projectList();
  }

  private getServerStatus(): unknown {
    const terminals = this.deps.projectStore.listTerminals();
    const activeWorkflows = this.getActiveWorkflows();
    const recentEvents = this.deps.eventBus?.getRecentEvents(50) ?? [];
    return {
      terminals: terminals.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        status: t.status,
        project: t.project,
        worktree: path.basename(t.worktree) || t.worktree,
      })),
      active_workflows: activeWorkflows.map((workflow) => ({
        id: workflow.id,
        status: workflow.status,
        current_assignment_id: workflow.current_assignment_id,
        updated_at: workflow.updated_at,
      })),
      recent_events: recentEvents,
      server: {
        version: this.serverVersion,
        uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1000),
        config: {
          host: this.boundHost,
          port: this.boundPort,
          rate_limit: this.rateLimit,
          cors_origins: this.corsOrigins,
          api_token_configured: Boolean(this.apiToken),
          webhook_enabled: Boolean(process.env.TERMCANVAS_WEBHOOK_URL?.trim()),
        },
      },
    };
  }

  private handleSSE(terminalId: string, res: http.ServerResponse): void {
    const eventBus = this.deps.eventBus;
    if (!eventBus) {
      res.writeHead(501);
      res.end(JSON.stringify({ error: "Event bus not configured" }));
      return;
    }

    const terminal = this.deps.projectStore.getTerminal(terminalId);
    if (!terminal) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Terminal not found" }));
      return;
    }

    if (this.sseConnectionCount >= HeadlessApiServer.MAX_SSE_CONNECTIONS) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: "Too many SSE connections" }));
      return;
    }

    this.sseConnectionCount++;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":ok\n\n");

    for (const event of eventBus.getTerminalEvents(terminalId, 50)) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const listener = (event: import("./event-bus.ts").ServerEvent) => {
      const p = event.payload;
      if (p.terminalId !== terminalId) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventBus.on("*", listener);

    res.on("close", () => {
      eventBus.off("*", listener);
      this.sseConnectionCount--;
    });
  }

  private async startDiskUsagePolling(): Promise<void> {
    const wsDir = this.deps.workspaceDir;
    if (!wsDir) return;

    const update = async () => {
      try {
        this.diskUsageRefresh = Promise.resolve().then(() =>
          HeadlessApiServer.calculateDirectorySize(wsDir)
        );
        this.diskUsageBytes = await this.diskUsageRefresh;
      } catch {
        this.diskUsageBytes = null;
      } finally {
        this.diskUsageRefresh = null;
      }
    };

    await update();
    this.diskUsageTimer = setInterval(() => {
      void update();
    }, 30_000);
  }

  private getActiveWorkflows() {
    return listActiveWorkflowSummaries({
      workspaceDir: this.deps.workspaceDir,
      projectPaths: this.deps.projectStore.getProjects().map((project) => project.path),
    });
  }

  private static calculateDirectorySize(targetPath: string): number {
    const stats = fs.lstatSync(targetPath);
    if (!stats.isDirectory()) {
      return stats.size;
    }

    let total = 0;
    for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
      const entryPath = path.join(targetPath, entry.name);
      if (entry.isDirectory()) {
        total += HeadlessApiServer.calculateDirectorySize(entryPath);
      } else {
        total += fs.lstatSync(entryPath).size;
      }
    }
    return total;
  }

  private handlePtyWebSocket(ws: WebSocket, url: URL): void {
    const ptyIdParam = url.searchParams.get("ptyId");

    if (ptyIdParam) {
      const ptyId = parseInt(ptyIdParam, 10);
      if (Number.isNaN(ptyId)) {
        ws.close(1008, "Invalid ptyId");
        return;
      }
      this.attachToPty(ws, ptyId);
    } else {
      this.createAndAttachPty(ws);
    }
  }

  private attachToPty(ws: WebSocket, ptyId: number): void {
    // PtyManager.onData/onExit don't return cleanup functions —
    // cleanup happens automatically when the PTY is destroyed.
    this.deps.ptyManager.onData(ptyId, (data: string) => {
      this.deps.ptyManager.captureOutput(ptyId, data);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    this.deps.ptyManager.onExit(ptyId, () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "PTY exited");
      }
    });

    ws.on("message", (data) => {
      const text =
        typeof data === "string" ? data : (data as Buffer).toString();
      this.deps.ptyManager.write(ptyId, text);
    });

    ws.on("close", () => {
      // PTY continues to live; destroy only if this was a newly-created shell
    });
  }

  private createAndAttachPty(ws: WebSocket): void {
    const cwd = this.deps.workspaceDir ?? process.cwd();

    void this.deps.ptyManager
      .create({ cwd })
      .then((ptyId) => {
        this.attachToPty(ws, ptyId);
      })
      .catch((err) => {
        console.error("[api-server] failed to create PTY:", err);
        ws.close(1011, "Failed to create PTY");
      });
  }
}
