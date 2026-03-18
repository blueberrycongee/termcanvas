import http from "http";
import fs from "fs";
import { execSync } from "child_process";
import path from "path";
import type { BrowserWindow } from "electron";
import type { PtyManager } from "./pty-manager";
import type { ProjectScanner } from "./project-scanner";

interface ApiServerDeps {
  getWindow: () => BrowserWindow | null;
  ptyManager: PtyManager;
  projectScanner: ProjectScanner;
}

export class ApiServer {
  private server: http.Server | null = null;
  private deps: ApiServerDeps;

  constructor(deps: ApiServerDeps) {
    this.deps = deps;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) =>
        this.handleRequest(req, res),
      );
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve(port);
      });
      this.server.on("error", reject);
    });
  }

  stop() {
    this.server?.close();
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const method = req.method ?? "GET";
    const pathname = url.pathname;

    res.setHeader("Content-Type", "application/json");

    try {
      const body =
        method === "POST" || method === "DELETE"
          ? await this.readBody(req)
          : null;
      const result = await this.route(method, pathname, url, body);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (err: any) {
      const status = err.status ?? 500;
      res.writeHead(status);
      res.end(JSON.stringify({ error: err.message ?? "Internal error" }));
    }
  }

  private async route(
    method: string,
    pathname: string,
    url: URL,
    body: any,
  ): Promise<any> {
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

    // Diff
    if (method === "GET" && pathname.startsWith("/diff/")) {
      const worktreePath = decodeURIComponent(pathname.slice("/diff/".length));
      const summary = url.searchParams.has("summary");
      return this.getDiff(worktreePath, summary);
    }

    // State
    if (method === "GET" && pathname === "/state") {
      return this.getState();
    }

    throw Object.assign(new Error("Not found"), { status: 404 });
  }

  private async execRenderer(code: string): Promise<any> {
    const win = this.deps.getWindow();
    if (!win)
      throw Object.assign(new Error("No active window"), { status: 503 });

    // Wrap in renderer-side try-catch so the actual error message survives
    // instead of Electron's generic "Script failed to execute" wrapper.
    const wrapped = `(async()=>{try{return await(${code})}catch(e){return{__tcErr:true,message:e.message,stack:e.stack}}})()`;
    const result = await win.webContents.executeJavaScript(wrapped);
    if (result && result.__tcErr) {
      throw Object.assign(new Error(result.message), { status: 500 });
    }
    return result;
  }

  private readBody(req: http.IncomingMessage): Promise<any> {
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

  private async projectAdd(body: any) {
    const dirPath = body?.path;
    if (!dirPath)
      throw Object.assign(new Error("path is required"), { status: 400 });

    const scanned = this.deps.projectScanner.scan(dirPath);
    if (!scanned)
      throw Object.assign(new Error("Not a git repository"), { status: 400 });

    const projectData = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: scanned.name,
      path: scanned.path,
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 0,
      worktrees: scanned.worktrees.map((wt: any, i: number) => ({
        id: `${Date.now()}-wt-${i}`,
        name: wt.branch,
        path: wt.path,
        position: { x: 0, y: i * 400 },
        collapsed: false,
        terminals: [],
      })),
    };

    await this.execRenderer(
      `window.__tcApi.addProject(${JSON.stringify(projectData)})`,
    );
    return {
      id: projectData.id,
      name: projectData.name,
      worktrees: projectData.worktrees.length,
    };
  }

  private async projectList() {
    return this.execRenderer(`window.__tcApi.getProjects()`);
  }

  private async projectRemove(id: string) {
    await this.execRenderer(
      `window.__tcApi.removeProject(${JSON.stringify(id)})`,
    );
    return { ok: true };
  }

  private async projectRescan(projectId: string) {
    const projects = await this.execRenderer(`window.__tcApi.getProjects()`);
    const project = projects.find((p: any) => p.id === projectId);
    if (!project)
      throw Object.assign(new Error("Project not found"), { status: 404 });

    const worktrees = this.deps.projectScanner.listWorktrees(project.path);
    await this.execRenderer(
      `window.__tcApi.syncWorktrees(${JSON.stringify(project.path)}, ${JSON.stringify(worktrees)})`,
    );
    return { ok: true, worktrees: worktrees.length };
  }

  private async terminalCreate(body: any) {
    const worktree = body?.worktree;
    const type = body?.type ?? "shell";
    const prompt = body?.prompt as string | undefined;
    const autoApprove = body?.autoApprove as boolean | undefined;
    const parentTerminalId = body?.parentTerminalId as string | undefined;
    if (!worktree)
      throw Object.assign(new Error("worktree path is required"), {
        status: 400,
      });

    const projects = await this.execRenderer(`window.__tcApi.getProjects()`);
    let projectId: string | null = null;
    let worktreeId: string | null = null;

    for (const p of projects) {
      for (const w of p.worktrees) {
        if (w.path === worktree) {
          projectId = p.id;
          worktreeId = w.id;
          break;
        }
      }
      if (projectId) break;
    }

    if (!projectId || !worktreeId) {
      throw Object.assign(new Error("Worktree not found on canvas"), {
        status: 404,
      });
    }

    const terminal = await this.execRenderer(
      `window.__tcApi.addTerminal(${JSON.stringify(projectId)}, ${JSON.stringify(worktreeId)}, ${JSON.stringify(type)}, ${JSON.stringify(prompt)}, ${JSON.stringify(!!autoApprove)}, ${JSON.stringify(parentTerminalId ?? null)})`,
    );
    return { id: terminal.id, type: terminal.type, title: terminal.title };
  }

  private async terminalList(worktreePath: string | null) {
    const projects = await this.execRenderer(`window.__tcApi.getProjects()`);
    const terminals: any[] = [];

    for (const p of projects) {
      for (const w of p.worktrees) {
        if (worktreePath && w.path !== worktreePath) continue;
        for (const t of w.terminals) {
          terminals.push({
            id: t.id,
            title: t.title,
            type: t.type,
            status: t.status,
            ptyId: t.ptyId,
            worktree: w.path,
            project: p.name,
          });
        }
      }
    }
    return terminals;
  }

  private async terminalInput(terminalId: string, body: any) {
    const text = body?.text;
    if (!text)
      throw Object.assign(new Error("text is required"), { status: 400 });

    const terminal = await this.execRenderer(
      `window.__tcApi.getTerminal(${JSON.stringify(terminalId)})`,
    );
    if (!terminal)
      throw Object.assign(new Error("Terminal not found"), { status: 404 });
    if (!terminal.ptyId)
      throw Object.assign(new Error("Terminal has no active PTY"), {
        status: 409,
      });

    this.deps.ptyManager.write(terminal.ptyId, text);
    return { ok: true };
  }

  private async terminalStatus(terminalId: string) {
    const terminal = await this.execRenderer(
      `window.__tcApi.getTerminal(${JSON.stringify(terminalId)})`,
    );
    if (!terminal)
      throw Object.assign(new Error("Terminal not found"), { status: 404 });
    return { id: terminal.id, status: terminal.status, ptyId: terminal.ptyId };
  }

  private async terminalOutput(terminalId: string, lines: number) {
    const terminal = await this.execRenderer(
      `window.__tcApi.getTerminal(${JSON.stringify(terminalId)})`,
    );
    if (!terminal)
      throw Object.assign(new Error("Terminal not found"), { status: 404 });
    if (!terminal.ptyId) return { id: terminalId, lines: [] };
    const output = this.deps.ptyManager.getOutput(terminal.ptyId, lines);
    return { id: terminalId, lines: output };
  }

  private async terminalDestroy(terminalId: string) {
    const terminal = await this.execRenderer(
      `window.__tcApi.getTerminal(${JSON.stringify(terminalId)})`,
    );
    if (!terminal)
      throw Object.assign(new Error("Terminal not found"), { status: 404 });
    if (terminal.ptyId) {
      this.deps.ptyManager.destroy(terminal.ptyId);
    }
    await this.execRenderer(
      `window.__tcApi.removeTerminal(${JSON.stringify(terminal.projectId)}, ${JSON.stringify(terminal.worktreeId)}, ${JSON.stringify(terminalId)})`,
    );
    return { ok: true };
  }

  private getDiff(worktreePath: string, summary: boolean) {
    try {
      // Untracked file list (shared by both modes)
      const untrackedRaw = execSync(
        "git ls-files --others --exclude-standard",
        { cwd: worktreePath, encoding: "utf-8" },
      );
      const untrackedNames = untrackedRaw.trim().split("\n").filter(Boolean);

      if (summary) {
        const numstat = execSync("git diff HEAD --numstat", {
          cwd: worktreePath,
          encoding: "utf-8",
        });
        const files = numstat
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line: string) => {
            const [add, del, name] = line.split("\t");
            const binary = add === "-";
            return {
              name,
              additions: binary ? 0 : parseInt(add, 10),
              deletions: binary ? 0 : parseInt(del, 10),
              binary,
            };
          });

        for (const name of untrackedNames) {
          const filePath = path.join(worktreePath, name);
          try {
            const content = fs.readFileSync(filePath, "utf-8");
            const lineCount = content.split("\n").filter((_, i, a) =>
              i < a.length - 1 || a[i] !== "",
            ).length;
            files.push({ name, additions: lineCount, deletions: 0, binary: false });
          } catch {
            files.push({ name, additions: 0, deletions: 0, binary: true });
          }
        }

        return { worktree: worktreePath, files };
      }

      const diff = execSync("git diff HEAD", {
        cwd: worktreePath,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });

      let untrackedDiff = "";
      for (const name of untrackedNames) {
        try {
          const content = fs.readFileSync(
            path.join(worktreePath, name), "utf-8",
          );
          const lines = content.split("\n");
          if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
          const addLines = lines.map((l) => `+${l}`).join("\n");
          untrackedDiff += `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,${lines.length} @@\n${addLines}\n`;
        } catch {
          untrackedDiff += `diff --git a/${name} b/${name}\nnew file\nBinary file\n`;
        }
      }

      return { worktree: worktreePath, diff: diff + untrackedDiff };
    } catch (err: any) {
      throw Object.assign(new Error(`Failed to get diff: ${err.message}`), {
        status: 400,
      });
    }
  }

  private async getState() {
    return this.execRenderer(`window.__tcApi.getProjects()`);
  }
}
