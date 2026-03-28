/**
 * Headless API server — replaces electron/api-server.ts without Electron dependencies.
 * All execRenderer calls are replaced with direct ProjectStore method calls.
 * Same HTTP API contract (routes, request/response shapes) as the Electron version.
 */

import http from "node:http";
import { URL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { ProjectStore } from "./project-store.ts";
import type { PtyManager } from "../electron/pty-manager.ts";
import type { ProjectScanner } from "../electron/project-scanner.ts";
import { getApiDiff } from "../electron/git-diff.ts";
import type { TelemetryService } from "../electron/telemetry-service.ts";

interface HeadlessApiServerDeps {
  projectStore: ProjectStore;
  ptyManager: PtyManager;
  projectScanner: ProjectScanner;
  telemetryService: TelemetryService;
  workspaceDir?: string;
}

export class HeadlessApiServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly deps: HeadlessApiServerDeps;

  constructor(deps: HeadlessApiServerDeps) {
    this.deps = deps;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) =>
        this.handleRequest(req, res),
      );

      // WebSocket upgrade handling
      this.wss = new WebSocketServer({ noServer: true });

      this.server.on("upgrade", (request, socket, head) => {
        const url = new URL(
          request.url ?? "/",
          `http://${request.headers.host}`,
        );

        if (url.pathname === "/pty/stream") {
          this.wss!.handleUpgrade(request, socket, head, (ws) => {
            this.handlePtyWebSocket(ws, url);
          });
        } else {
          socket.destroy();
        }
      });

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve(port);
      });
      this.server.on("error", reject);
    });
  }

  stop(): void {
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
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const method = req.method ?? "GET";
    const pathname = url.pathname;

    res.setHeader("Content-Type", "application/json");

    try {
      const body =
        method === "POST" || method === "PUT" || method === "DELETE"
          ? await this.readBody(req)
          : null;
      const result = await this.route(method, pathname, url, body);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      const status =
        err instanceof Object && "status" in err
          ? (err as { status: number }).status
          : 500;
      const message =
        err instanceof Error ? err.message : "Internal error";
      res.writeHead(status);
      res.end(JSON.stringify({ error: message }));
    }
  }

  private async route(
    method: string,
    pathname: string,
    url: URL,
    body: unknown,
  ): Promise<unknown> {
    // Project endpoints
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

    // Terminal endpoints
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

    // Diff
    if (method === "GET" && pathname.startsWith("/diff/")) {
      const worktreePath = decodeURIComponent(
        pathname.slice("/diff/".length),
      );
      const summary = url.searchParams.has("summary");
      return this.getDiff(worktreePath, summary);
    }

    // State
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

  // --- Project routes ---

  private projectAdd(body: unknown): {
    id: string;
    name: string;
    worktrees: number;
  } {
    const { path: dirPath } = body as { path?: string };
    if (!dirPath) {
      throw Object.assign(new Error("path is required"), { status: 400 });
    }

    const scanned = this.deps.projectScanner.scan(dirPath);
    if (!scanned) {
      throw Object.assign(new Error("Not a git repository"), { status: 400 });
    }

    const projectData = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: scanned.name,
      path: scanned.path,
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 0,
      worktrees: scanned.worktrees.map(
        (wt: { path: string; branch: string }, i: number) => ({
          id: `${Date.now()}-wt-${i}`,
          name: wt.branch,
          path: wt.path,
          position: { x: 0, y: i * 400 },
          collapsed: false,
          terminals: [],
        }),
      ),
    };

    this.deps.projectStore.addProject(projectData);

    return {
      id: projectData.id,
      name: projectData.name,
      worktrees: projectData.worktrees.length,
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
    return { ok: true };
  }

  private projectRescan(projectId: string): {
    ok: boolean;
    worktrees: number;
  } {
    const project = this.deps.projectStore.getProjectById(projectId);
    if (!project) {
      throw Object.assign(new Error("Project not found"), { status: 404 });
    }

    const worktrees = this.deps.projectScanner.listWorktrees(project.path);
    this.deps.projectStore.syncWorktrees(project.path, worktrees);
    return { ok: true, worktrees: worktrees.length };
  }

  // --- Terminal routes ---

  private terminalCreate(body: unknown): {
    id: string;
    type: string;
    title: string;
  } {
    const {
      worktree,
      type = "shell",
      prompt,
      autoApprove,
      parentTerminalId,
      workflowId,
      handoffId,
      repoPath,
    } = body as {
      worktree?: string;
      type?: string;
      prompt?: string;
      autoApprove?: boolean;
      parentTerminalId?: string;
      workflowId?: string;
      handoffId?: string;
      repoPath?: string;
    };

    if (!worktree) {
      throw Object.assign(new Error("worktree path is required"), {
        status: 400,
      });
    }

    const found = this.deps.projectStore.findWorktree(worktree);
    if (!found) {
      throw Object.assign(new Error("Worktree not found on canvas"), {
        status: 404,
      });
    }

    const terminal = this.deps.projectStore.addTerminal(
      found.projectId,
      found.worktreeId,
      type as Parameters<typeof this.deps.projectStore.addTerminal>[2],
      prompt,
      autoApprove,
      parentTerminalId,
    );

    this.deps.telemetryService.registerTerminal({
      terminalId: terminal.id,
      worktreePath: worktree,
      provider:
        type === "claude" || type === "codex" ? type : "unknown",
      workflowId,
      handoffId,
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
    const terminal = this.deps.projectStore.getTerminal(terminalId);
    if (!terminal) {
      throw Object.assign(new Error("Terminal not found"), { status: 404 });
    }
    if (terminal.ptyId) {
      this.deps.ptyManager.destroy(terminal.ptyId);
    }
    this.deps.projectStore.removeTerminal(
      terminal.projectId,
      terminal.worktreeId,
      terminalId,
    );
    return { ok: true };
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
    return { ok: true };
  }

  // --- Telemetry routes ---

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

  // --- Diff route ---

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

  // --- State route ---

  private getState(): unknown {
    return this.projectList();
  }

  // --- WebSocket PTY ---

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
