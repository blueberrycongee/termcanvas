import http from "http";
import https from "https";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveTermCanvasPortFile } from "../shared/termcanvas-instance";

const CONNECTION_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRYABLE_CODES = new Set(["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"]);

interface ConnectionTarget {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
  basePath: string;
}

function normalizeBasePath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "";
  }
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function buildRequestPath(basePath: string, urlPath: string): string {
  const [pathname, search = ""] = urlPath.split("?");
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const resolvedPath = `${basePath}${normalizedPath}`;
  return search ? `${resolvedPath}?${search}` : resolvedPath;
}

function getConnection(): ConnectionTarget {
  const envUrl = process.env.TERMCANVAS_URL?.trim();
  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
      }
      const port = parsed.port
        ? parseInt(parsed.port, 10)
        : parsed.protocol === "https:" ? 443 : 80;
      return {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port,
        basePath: normalizeBasePath(parsed.pathname),
      };
    } catch {
      console.error(`Invalid TERMCANVAS_URL: ${envUrl}`);
      process.exit(1);
    }
  }

  const envHost = process.env.TERMCANVAS_HOST?.trim();
  const envPort = process.env.TERMCANVAS_PORT?.trim();

  if (envHost && envPort) {
    return {
      protocol: "http:",
      hostname: envHost,
      port: parseInt(envPort, 10),
      basePath: "",
    };
  }

  const portFile = resolveTermCanvasPortFile(process.env);
  try {
    const port = parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10);
    return {
      protocol: "http:",
      hostname: "127.0.0.1",
      port,
      basePath: "",
    };
  } catch {
    console.error(`TermCanvas is not running (no port file found at ${portFile}).`);
    process.exit(1);
  }
}

const apiToken = process.env.TERMCANVAS_API_TOKEN?.trim();

function requestOnce(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<any> {
  const { protocol, hostname, port, basePath } = getConnection();
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (data) headers["Content-Length"] = String(Buffer.byteLength(data));
    if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;

    const transport = protocol === "https:" ? https : http;
    const req = transport.request(
      {
        protocol,
        hostname,
        port,
        path: buildRequestPath(basePath, urlPath),
        method,
        headers,
        timeout: CONNECTION_TIMEOUT_MS,
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk: string) => (responseBody += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(responseBody);
            if (res.statusCode && res.statusCode >= 400) {
              reject(json);
            } else {
              resolve(json);
            }
          } catch {
            reject(new Error(responseBody));
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("ETIMEDOUT"));
    });
    req.on("error", (err) => reject(err));
    if (data) req.write(data);
    req.end();
  });
}

async function request(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await requestOnce(method, urlPath, body);
    } catch (err: unknown) {
      lastError = err;
      const code = err instanceof Error && "code" in err
        ? (err as NodeJS.ErrnoException).code
        : undefined;
      const isTimeout = err instanceof Error && err.message === "ETIMEDOUT";
      if ((code && RETRYABLE_CODES.has(code)) || isTimeout) {
        if (attempt < MAX_RETRIES) {
          const delay = 1000 * 2 ** attempt;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      throw err;
    }
  }
  const { protocol, hostname, port, basePath } = getConnection();
  console.error(
    `Failed to connect to TermCanvas at ${protocol}//${hostname}:${port}${basePath} after ${MAX_RETRIES + 1} attempts.\n` +
    `Check that the server is running and the host/port are correct.`,
  );
  throw lastError;
}

const args = process.argv.slice(2);
const jsonFlag = args.includes("--json");
const filteredArgs = args.filter((a) => a !== "--json");
const [group, command, ...rest] = filteredArgs;

async function main() {
  try {
    if (group === "project") {
      if (command === "add" && rest[0]) {
        const result = await request("POST", "/project/add", { path: rest[0] });
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else
          console.log(
            `Added "${result.name}" with ${result.worktrees} worktree(s). ID: ${result.id}`,
          );
      } else if (command === "list") {
        const projects = await request("GET", "/project/list");
        if (jsonFlag) {
          console.log(JSON.stringify(projects, null, 2));
          return;
        }
        if (projects.length === 0) {
          console.log("No projects.");
          return;
        }
        for (const p of projects) {
          console.log(
            `${p.id}  ${p.name}  ${p.path}  (${p.worktrees.length} worktrees)`,
          );
        }
      } else if (command === "remove" && rest[0]) {
        const result = await request("DELETE", `/project/${rest[0]}`);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Removed.");
      } else if (command === "rescan" && rest[0]) {
        const result = await request("POST", `/project/${rest[0]}/rescan`);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`Rescanned. ${result.worktrees} worktree(s) found.`);
      } else {
        console.log("Usage: termcanvas project <add|list|remove> [args]");
      }
    } else if (group === "workflow") {
      // Lead-driven workflow CLI: a thin HTTP client over the headless server's
      // /workflow/* routes. Mirrors the in-process `hydra` binary commands but
      // dispatches over HTTP, so CI / remote / cross-process callers can drive
      // workflows without embedding the hydra package.
      const requireRepo = (): string => {
        const repoIdx = rest.indexOf("--repo");
        const repo = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
        if (!repo) {
          console.error("--repo is required");
          process.exit(1);
        }
        return repo;
      };
      const optionalFlag = (flag: string): string | undefined => {
        const idx = rest.indexOf(flag);
        return idx >= 0 && idx + 1 < rest.length ? rest[idx + 1] : undefined;
      };
      const optionalNumber = (flag: string): number | undefined => {
        const raw = optionalFlag(flag);
        if (raw === undefined) return undefined;
        const n = Number(raw);
        if (Number.isNaN(n)) {
          console.error(`Invalid number for ${flag}: ${raw}`);
          process.exit(1);
        }
        return n;
      };
      const listFlag = (flag: string): string[] => {
        const raw = optionalFlag(flag);
        return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
      };
      const requireWorkflowId = (): string => {
        const workflowId = rest[0];
        if (!workflowId || workflowId.startsWith("--")) {
          console.error(`workflow ${command} requires a workflow id as the first positional argument`);
          process.exit(1);
        }
        return workflowId;
      };
      const requireFlag = (flag: string): string => {
        const value = optionalFlag(flag);
        if (!value) {
          console.error(`${flag} is required`);
          process.exit(1);
        }
        return value;
      };

      if (command === "init") {
        const repo = requireRepo();
        const intent = requireFlag("--intent");
        const body: Record<string, unknown> = {
          intent,
          repoPath: repo,
        };
        const worktree = optionalFlag("--worktree");
        if (worktree) body.worktreePath = worktree;
        const timeoutMinutes = optionalNumber("--timeout-minutes");
        if (timeoutMinutes !== undefined) body.timeoutMinutes = timeoutMinutes;
        const maxRetries = optionalNumber("--max-retries");
        if (maxRetries !== undefined) body.maxRetries = maxRetries;
        if (rest.includes("--no-auto-approve")) body.autoApprove = false;

        const result = await request("POST", "/workflow/init", body);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`Initialized workflow ${result.workflow_id}.`);
      } else if (command === "dispatch") {
        const workflowId = requireWorkflowId();
        const repo = requireRepo();
        const body: Record<string, unknown> = {
          repoPath: repo,
          nodeId: requireFlag("--node"),
          role: requireFlag("--role"),
          intent: requireFlag("--intent"),
        };
        const dependsOn = listFlag("--depends-on");
        if (dependsOn.length > 0) body.dependsOn = dependsOn;
        const model = optionalFlag("--model");
        if (model) body.model = model;
        const feedback = optionalFlag("--feedback");
        if (feedback) body.feedback = feedback;
        const worktree = optionalFlag("--worktree");
        if (worktree) body.worktreePath = worktree;
        const worktreeBranch = optionalFlag("--worktree-branch");
        if (worktreeBranch) body.worktreeBranch = worktreeBranch;
        const timeoutMinutes = optionalNumber("--timeout-minutes");
        if (timeoutMinutes !== undefined) body.timeoutMinutes = timeoutMinutes;
        const maxRetries = optionalNumber("--max-retries");
        if (maxRetries !== undefined) body.maxRetries = maxRetries;

        const result = await request(
          "POST",
          `/workflow/${encodeURIComponent(workflowId)}/dispatch`,
          body,
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`${result.status}  node=${result.node_id}  assignment=${result.assignment_id}`);
      } else if (command === "redispatch") {
        const workflowId = requireWorkflowId();
        const repo = requireRepo();
        const nodeId = requireFlag("--node");
        const body: Record<string, unknown> = { repoPath: repo };
        const intent = optionalFlag("--intent");
        if (intent) body.intent = intent;

        const result = await request(
          "POST",
          `/workflow/${encodeURIComponent(workflowId)}/node/${encodeURIComponent(nodeId)}/redispatch`,
          body,
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`${result.status}  node=${result.node_id}`);
      } else if (command === "watch") {
        const workflowId = requireWorkflowId();
        const repo = requireRepo();
        const result = await request(
          "POST",
          `/workflow/${encodeURIComponent(workflowId)}/watch-decision`,
          { repoPath: repo },
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`${result.type}  workflow=${result.workflow_id}`);
      } else if (command === "approve") {
        const workflowId = requireWorkflowId();
        const repo = requireRepo();
        const nodeId = requireFlag("--node");
        const result = await request(
          "POST",
          `/workflow/${encodeURIComponent(workflowId)}/node/${encodeURIComponent(nodeId)}/approve`,
          { repoPath: repo },
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`Approved node ${nodeId}.`);
      } else if (command === "reset") {
        const workflowId = requireWorkflowId();
        const repo = requireRepo();
        const nodeId = requireFlag("--node");
        const body: Record<string, unknown> = { repoPath: repo };
        const feedback = optionalFlag("--feedback");
        if (feedback) body.feedback = feedback;
        const result = await request(
          "POST",
          `/workflow/${encodeURIComponent(workflowId)}/node/${encodeURIComponent(nodeId)}/reset`,
          body,
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`Reset node ${nodeId} (${result.reset_node_ids?.length ?? 0} nodes affected).`);
      } else if (command === "merge") {
        const workflowId = requireWorkflowId();
        const repo = requireRepo();
        const nodeIds = listFlag("--nodes");
        if (nodeIds.length === 0) {
          console.error("--nodes is required (comma-separated node IDs)");
          process.exit(1);
        }
        const result = await request(
          "POST",
          `/workflow/${encodeURIComponent(workflowId)}/merge`,
          { repoPath: repo, nodeIds },
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`Merged ${nodeIds.length} nodes.`);
      } else if (command === "complete") {
        const workflowId = requireWorkflowId();
        const repo = requireRepo();
        const body: Record<string, unknown> = { repoPath: repo };
        const summary = optionalFlag("--summary");
        if (summary) body.summary = summary;
        const result = await request(
          "POST",
          `/workflow/${encodeURIComponent(workflowId)}/complete`,
          body,
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Workflow completed.");
      } else if (command === "fail") {
        const workflowId = requireWorkflowId();
        const repo = requireRepo();
        const reason = requireFlag("--reason");
        const result = await request(
          "POST",
          `/workflow/${encodeURIComponent(workflowId)}/fail`,
          { repoPath: repo, reason },
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Workflow failed.");
      } else if (command === "list") {
        const repo = requireRepo();
        const result = await request(
          "GET",
          `/workflow/list?repo=${encodeURIComponent(repo)}`,
        );
        if (jsonFlag) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (result.length === 0) {
          console.log("No workflows.");
          return;
        }
        for (const workflow of result) {
          console.log(`${workflow.id}  ${workflow.status}  ${workflow.updated_at}`);
        }
      } else if (command === "list-roles") {
        const repo = requireRepo();
        const params = new URLSearchParams({ repo });
        const cli = optionalFlag("--cli") ?? optionalFlag("--agent-type");
        if (cli) params.set("agentType", cli);
        const result = await request("GET", `/workflow/list-roles?${params.toString()}`);
        console.log(JSON.stringify(result, null, 2));
      } else if (command === "status") {
        const workflowId = requireWorkflowId();
        const repo = requireRepo();
        const result = await request(
          "GET",
          `/workflow/${encodeURIComponent(workflowId)}?repo=${encodeURIComponent(repo)}`,
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`${result.workflow.status}  ${result.workflow.id}`);
      } else if (command === "cleanup") {
        const workflowId = requireWorkflowId();
        const repo = requireRepo();
        const force = rest.includes("--force");
        const query = new URLSearchParams({ repo });
        if (force) query.set("force", "true");
        const result = await request(
          "DELETE",
          `/workflow/${encodeURIComponent(workflowId)}?${query.toString()}`,
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Cleaned up.");
      } else {
        console.log(
          "Usage: termcanvas workflow <init|dispatch|redispatch|watch|approve|reset|merge|complete|fail|list|list-roles|status|cleanup> [args]",
        );
      }
    } else if (group === "worktree") {
      if (command === "list") {
        const repoIdx = rest.indexOf("--repo");
        const repo = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
        if (!repo) {
          console.error("--repo is required");
          process.exit(1);
        }
        const result = await request(
          "GET",
          `/worktree/list?repo=${encodeURIComponent(repo)}`,
        );
        if (jsonFlag) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (result.length === 0) {
          console.log("No worktrees.");
          return;
        }
        for (const worktree of result) {
          console.log(`${worktree.path}  ${worktree.branch}`);
        }
      } else if (command === "create") {
        const repoIdx = rest.indexOf("--repo");
        const branchIdx = rest.indexOf("--branch");
        const pathIdx = rest.indexOf("--path");
        const baseBranchIdx = rest.indexOf("--base-branch");
        const repo = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
        const branch = branchIdx >= 0 ? rest[branchIdx + 1] : undefined;
        const worktreePath = pathIdx >= 0 ? rest[pathIdx + 1] : undefined;
        const baseBranch = baseBranchIdx >= 0 ? rest[baseBranchIdx + 1] : undefined;
        if (!repo) {
          console.error("--repo is required");
          process.exit(1);
        }
        if (!branch) {
          console.error("--branch is required");
          process.exit(1);
        }
        const result = await request("POST", "/worktree/create", {
          repo,
          branch,
          ...(worktreePath ? { path: worktreePath } : {}),
          ...(baseBranch ? { baseBranch } : {}),
        });
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`Created ${result.path}.`);
      } else if (command === "remove") {
        const repoIdx = rest.indexOf("--repo");
        const pathIdx = rest.indexOf("--path");
        const repo = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
        const worktreePath = pathIdx >= 0 ? rest[pathIdx + 1] : undefined;
        const force = rest.includes("--force");
        if (!repo) {
          console.error("--repo is required");
          process.exit(1);
        }
        if (!worktreePath) {
          console.error("--path is required");
          process.exit(1);
        }
        const query = new URLSearchParams({
          repo,
          path: worktreePath,
        });
        if (force) query.set("force", "true");
        const result = await request("DELETE", `/worktree?${query.toString()}`);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Removed.");
      } else {
        console.log("Usage: termcanvas worktree <list|create|remove> [args]");
      }
    } else if (group === "terminal") {
      if (command === "create") {
        const wtIdx = rest.indexOf("--worktree");
        const typeIdx = rest.indexOf("--type");
        const promptIdx = rest.indexOf("--prompt");
        const parentIdx = rest.indexOf("--parent-terminal");
        const workflowIdx = rest.indexOf("--workflow-id");
        const assignmentIdx = rest.indexOf("--assignment-id");
        const repoIdx = rest.indexOf("--repo");
        const resumeIdx = rest.indexOf("--resume-session-id");
        const autoApprove = rest.includes("--auto-approve");
        const worktree = wtIdx >= 0 ? rest[wtIdx + 1] : undefined;
        const type = typeIdx >= 0 ? rest[typeIdx + 1] : "shell";
        const prompt = promptIdx >= 0 ? rest[promptIdx + 1] : undefined;
        const parentTerminalId = parentIdx >= 0 ? rest[parentIdx + 1] : undefined;
        const workflowId = workflowIdx >= 0 ? rest[workflowIdx + 1] : undefined;
        const assignmentId = assignmentIdx >= 0 ? rest[assignmentIdx + 1] : undefined;
        const repoPath = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
        const resumeSessionId = resumeIdx >= 0 ? rest[resumeIdx + 1] : undefined;
        if (!worktree) {
          console.error("--worktree is required");
          process.exit(1);
        }
        const result = await request("POST", "/terminal/create", {
          worktree,
          type,
          ...(prompt ? { prompt } : {}),
          ...(autoApprove ? { autoApprove: true } : {}),
          ...(parentTerminalId ? { parentTerminalId } : {}),
          ...(workflowId ? { workflowId } : {}),
          ...(assignmentId ? { assignmentId } : {}),
          ...(repoPath ? { repoPath } : {}),
          ...(resumeSessionId ? { resumeSessionId } : {}),
        });
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else
          console.log(
            `Created ${result.type} terminal "${result.title}". ID: ${result.id}`,
          );
      } else if (command === "list") {
        const wtIdx = rest.indexOf("--worktree");
        const worktree = wtIdx >= 0 ? rest[wtIdx + 1] : undefined;
        const query = worktree
          ? `?worktree=${encodeURIComponent(worktree)}`
          : "";
        const terminals = await request("GET", `/terminal/list${query}`);
        if (jsonFlag) {
          console.log(JSON.stringify(terminals, null, 2));
          return;
        }
        if (terminals.length === 0) {
          console.log("No terminals.");
          return;
        }
        for (const t of terminals) {
          console.log(
            `${t.id}  ${t.type}  ${t.status}  ${t.title}  (${t.project}/${t.worktree})`,
          );
        }
      } else if (command === "status" && rest[0]) {
        const result = await request("GET", `/terminal/${rest[0]}/status`);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(result.status);
      } else if (command === "output" && rest[0]) {
        const linesIdx = rest.indexOf("--lines");
        const lines = linesIdx >= 0 ? rest[linesIdx + 1] : "50";
        const result = await request(
          "GET",
          `/terminal/${rest[0]}/output?lines=${lines}`,
        );
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(result.lines.join("\n"));
      } else if (command === "destroy" && rest[0]) {
        const result = await request("DELETE", `/terminal/${rest[0]}`);
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Destroyed.");
      } else if (command === "set-title" && rest[0] && rest[1]) {
        const title = rest.slice(1).join(" ");
        const result = await request("PUT", `/terminal/${rest[0]}/custom-title`, {
          customTitle: title,
        });
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Title updated.");
      } else if (command === "input") {
        console.error(
          "termcanvas terminal input has been removed. Start Claude/Codex tasks with `termcanvas terminal create --prompt \"...\"` instead.",
        );
        process.exit(1);
      } else {
        console.log(
          "Usage: termcanvas terminal <create|list|status|output|destroy|set-title> [args]",
        );
        process.exit(1);
      }
    } else if (group === "telemetry") {
      if (command === "get") {
        const terminalIdx = rest.indexOf("--terminal");
        const workflowIdx = rest.indexOf("--workflow");
        const repoIdx = rest.indexOf("--repo");
        const terminalId = terminalIdx >= 0 ? rest[terminalIdx + 1] : undefined;
        const workflowId = workflowIdx >= 0 ? rest[workflowIdx + 1] : undefined;
        const repoPath = repoIdx >= 0 ? rest[repoIdx + 1] : process.cwd();

        if (terminalId) {
          const result = await request("GET", `/telemetry/terminal/${encodeURIComponent(terminalId)}`);
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (workflowId) {
          const result = await request(
            "GET",
            `/telemetry/workflow/${encodeURIComponent(workflowId)}?repo=${encodeURIComponent(repoPath)}`,
          );
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.error("Provide --terminal <id> or --workflow <id>");
        process.exit(1);
      } else if (command === "events") {
        const terminalIdx = rest.indexOf("--terminal");
        const limitIdx = rest.indexOf("--limit");
        const cursorIdx = rest.indexOf("--cursor");
        const terminalId = terminalIdx >= 0 ? rest[terminalIdx + 1] : undefined;
        const limit = limitIdx >= 0 ? rest[limitIdx + 1] : "50";
        const cursor = cursorIdx >= 0 ? rest[cursorIdx + 1] : undefined;
        if (!terminalId) {
          console.error("--terminal is required");
          process.exit(1);
        }
        const query = new URLSearchParams({ limit });
        if (cursor) query.set("cursor", cursor);
        const result = await request(
          "GET",
          `/telemetry/terminal/${encodeURIComponent(terminalId)}/events?${query.toString()}`,
        );
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(
          "Usage: termcanvas telemetry <get|events> [--terminal <id> | --workflow <id> --repo <path>]",
        );
      }
    } else if (group === "diff" && command) {
      const worktreePath = command;
      const summary = rest.includes("--summary");
      const query = summary ? "?summary" : "";
      const result = await request(
        "GET",
        `/diff/${encodeURIComponent(worktreePath)}${query}`,
      );
      if (jsonFlag) {
        console.log(JSON.stringify(result, null, 2));
      } else if (summary) {
        if (result.files.length === 0) {
          console.log("No changes.");
        } else {
          for (const f of result.files) {
            const stat = f.binary
              ? "binary"
              : `+${f.additions} -${f.deletions}`;
            console.log(`${stat}\t${f.name}`);
          }
        }
      } else {
        console.log(result.diff);
      }
    } else if (group === "computer-use") {
      if (command === "status") {
        const result = await request("GET", "/api/computer-use/status");
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else {
          console.log(`Enabled: ${result.enabled}`);
          console.log(`Helper running: ${result.helperRunning}`);
          console.log(`Accessibility: ${result.accessibilityGranted}`);
          console.log(`Screen Recording: ${result.screenRecordingGranted}`);
        }
      } else if (command === "enable") {
        const result = await request("POST", "/api/computer-use/enable");
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Computer Use enabled.");
      } else if (command === "disable") {
        const result = await request("POST", "/api/computer-use/disable");
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Computer Use disabled.");
      } else if (command === "stop") {
        const result = await request("POST", "/api/computer-use/stop");
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Computer Use stopped.");
      } else if (
        command === "list-apps" ||
        command === "open-app" ||
        command === "get-app-state" ||
        command === "click" ||
        command === "set-value" ||
        command === "perform-secondary-action" ||
        command === "type" ||
        command === "type-text" ||
        command === "press-key" ||
        command === "scroll" ||
        command === "drag"
      ) {
        const stateFilePath = path.join(os.homedir(), ".termcanvas", "computer-use", "state.json");
        let cuState: { port: number; token: string };
        try {
          cuState = JSON.parse(fs.readFileSync(stateFilePath, "utf-8"));
        } catch {
          console.error("Computer Use helper is not running (no state file found).");
          process.exit(1);
        }
        const flagValue = (name: string) => {
          const idx = rest.indexOf(name);
          return idx >= 0 ? rest[idx + 1] : undefined;
        };
        const firstFlagValue = (...names: string[]) => {
          for (const name of names) {
            const value = flagValue(name);
            if (value !== undefined) return value;
          }
          return undefined;
        };
        const numberFlag = (...names: string[]) => {
          const value = firstFlagValue(...names);
          if (value === undefined) return undefined;
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) {
            console.error(`${names[0]} must be a number`);
            process.exit(1);
          }
          return parsed;
        };
        const integerFlag = (...names: string[]) => {
          const parsed = numberFlag(...names);
          if (parsed === undefined) return undefined;
          if (!Number.isInteger(parsed)) {
            console.error(`${names[0]} must be an integer`);
            process.exit(1);
          }
          return parsed;
        };
        const booleanFlag = (...names: string[]) => {
          const value = firstFlagValue(...names);
          if (value === undefined) return undefined;
          const normalized = value.toLowerCase();
          if (["1", "true", "yes"].includes(normalized)) return true;
          if (["0", "false", "no"].includes(normalized)) return false;
          console.error(`${names[0]} must be true or false`);
          process.exit(1);
        };
        const requireFlag = (...names: string[]) => {
          const value = firstFlagValue(...names);
          if (!value) {
            console.error(`${names[0]} is required`);
            process.exit(1);
          }
          return value;
        };
        const addTarget = (body: Record<string, unknown>) => {
          const appName = firstFlagValue("--app-name", "--app", "--bundle-id");
          const pid = integerFlag("--pid");
          if (appName !== undefined) body.app_name = appName;
          if (pid !== undefined) body.pid = pid;
        };
        const addElement = (body: Record<string, unknown>) => {
          const element = flagValue("--element");
          const elementId = flagValue("--element-id");
          if (element !== undefined) {
            const parsed = Number(element);
            if (Number.isInteger(parsed)) body.element = parsed;
            else body.element_id = element;
          }
          if (elementId !== undefined) body.element_id = elementId;
        };
        const addCoordinates = (body: Record<string, unknown>) => {
          const x = numberFlag("--x");
          const y = numberFlag("--y");
          const coordinateSpace = flagValue("--coordinate-space");
          if (x !== undefined) body.x = x;
          if (y !== undefined) body.y = y;
          if (coordinateSpace !== undefined) body.coordinate_space = coordinateSpace;
        };
        const helperRequest = (endpoint: string, body?: unknown): Promise<unknown> => {
          return new Promise((resolve, reject) => {
            const data = body ? JSON.stringify(body) : "{}";
            const req = http.request(
              {
                hostname: "127.0.0.1",
                port: cuState.port,
                path: endpoint,
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Token": cuState.token,
                  "Content-Length": String(Buffer.byteLength(data)),
                },
                timeout: 30000,
              },
              (res) => {
                let body = "";
                res.on("data", (chunk: string) => (body += chunk));
                res.on("end", () => {
                  try { resolve(JSON.parse(body)); } catch { reject(new Error(body)); }
                });
              },
            );
            req.on("error", reject);
            req.write(data);
            req.end();
          });
        };

        if (command === "list-apps") {
          const result = await helperRequest("/list_apps");
          console.log(JSON.stringify(result, null, 2));
        } else if (command === "open-app") {
          const body: Record<string, unknown> = {};
          const bundleId = flagValue("--bundle-id");
          const name = firstFlagValue("--name", "--app-name", "--app");
          if (bundleId !== undefined) body.bundle_id = bundleId;
          if (name !== undefined) body.name = name;
          const result = await helperRequest("/open_app", body);
          console.log(JSON.stringify(result, null, 2));
        } else if (command === "get-app-state") {
          const body: Record<string, unknown> = {
            include_screenshot: booleanFlag("--include-screenshot") ?? true,
          };
          addTarget(body);
          const maxDepth = integerFlag("--max-depth");
          if (maxDepth !== undefined) body.max_depth = maxDepth;
          if (body.pid === undefined && body.app_name === undefined) {
            console.error("--app-name or --pid is required");
            process.exit(1);
          }
          const result = await helperRequest("/get_app_state", body);
          console.log(JSON.stringify(result, null, 2));
        } else if (command === "click") {
          const body: Record<string, unknown> = {};
          addTarget(body);
          addElement(body);
          addCoordinates(body);
          const clickCount = integerFlag("--click-count");
          const mouseButton = flagValue("--mouse-button");
          if (clickCount !== undefined) body.click_count = clickCount;
          if (mouseButton !== undefined) body.mouse_button = mouseButton;
          const result = await helperRequest("/click", body);
          console.log(JSON.stringify(result, null, 2));
        } else if (command === "set-value") {
          const body: Record<string, unknown> = { value: requireFlag("--value") };
          addTarget(body);
          addElement(body);
          const result = await helperRequest("/set_value", body);
          console.log(JSON.stringify(result, null, 2));
        } else if (command === "perform-secondary-action") {
          const body: Record<string, unknown> = { action: requireFlag("--action") };
          addTarget(body);
          addElement(body);
          const result = await helperRequest("/perform_secondary_action", body);
          console.log(JSON.stringify(result, null, 2));
        } else if (command === "type") {
          const result = await helperRequest("/type_text", { text: requireFlag("--text") });
          console.log(JSON.stringify(result, null, 2));
        } else if (command === "type-text") {
          const result = await helperRequest("/type_text", { text: requireFlag("--text") });
          console.log(JSON.stringify(result, null, 2));
        } else if (command === "press-key") {
          const result = await helperRequest("/press_key", { key: requireFlag("--key") });
          console.log(JSON.stringify(result, null, 2));
        } else if (command === "scroll") {
          const body: Record<string, unknown> = {};
          addTarget(body);
          addElement(body);
          addCoordinates(body);
          const direction = flagValue("--direction");
          const amount = numberFlag("--amount");
          const dx = numberFlag("--dx");
          const dy = numberFlag("--dy");
          if (direction !== undefined) body.direction = direction;
          if (amount !== undefined) body.amount = amount;
          if (dx !== undefined) body.dx = dx;
          if (dy !== undefined) body.dy = dy;
          const result = await helperRequest("/scroll", body);
          console.log(JSON.stringify(result, null, 2));
        } else if (command === "drag") {
          const body: Record<string, unknown> = {};
          addTarget(body);
          const startX = numberFlag("--start-x", "--from-x");
          const startY = numberFlag("--start-y", "--from-y");
          const endX = numberFlag("--end-x", "--to-x");
          const endY = numberFlag("--end-y", "--to-y");
          const fromElement = integerFlag("--from-element");
          const toElement = integerFlag("--to-element");
          const fromElementId = flagValue("--from-element-id");
          const toElementId = flagValue("--to-element-id");
          const coordinateSpace = flagValue("--coordinate-space");
          if (startX !== undefined) body.start_x = startX;
          if (startY !== undefined) body.start_y = startY;
          if (endX !== undefined) body.end_x = endX;
          if (endY !== undefined) body.end_y = endY;
          if (fromElement !== undefined) body.from_element = fromElement;
          if (toElement !== undefined) body.to_element = toElement;
          if (fromElementId !== undefined) body.from_element_id = fromElementId;
          if (toElementId !== undefined) body.to_element_id = toElementId;
          if (coordinateSpace !== undefined) body.coordinate_space = coordinateSpace;
          const result = await helperRequest("/drag", body);
          console.log(JSON.stringify(result, null, 2));
        }
      } else {
        console.log(
          "Usage: termcanvas computer-use <status|enable|disable|stop|list-apps|open-app|get-app-state|click|set-value|perform-secondary-action|type|type-text|press-key|scroll|drag> [args]",
        );
      }
    } else if (group === "state") {
      const state = await request("GET", "/state");
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(
        "Usage: termcanvas <project|workflow|worktree|terminal|telemetry|computer-use|diff|state> <command> [args]",
      );
      console.log("");
      console.log("Commands:");
      console.log(
        "  project add <path>                          Add a project",
      );
      console.log(
        "  project list                                List projects",
      );
      console.log(
        "  project remove <id>                         Remove a project",
      );
      console.log(
        "  project rescan <id>                         Rescan worktrees",
      );
      console.log(
        "  workflow init --intent <t> --repo <p>      Create a Lead-driven workflow",
      );
      console.log(
        "  workflow dispatch <id> --node <n> --role <r> --intent <t> --repo <p>",
      );
      console.log(
        "                                              Dispatch an agent node",
      );
      console.log(
        "  workflow redispatch <id> --node <n> --repo <p>",
      );
      console.log(
        "                                              Re-dispatch a reset node",
      );
      console.log(
        "  workflow watch <id> --repo <p>             Wait for next decision point",
      );
      console.log(
        "  workflow approve <id> --node <n> --repo <p>  Approve a node's output",
      );
      console.log(
        "  workflow reset <id> --node <n> --repo <p> [--feedback <t>]",
      );
      console.log(
        "                                              Reset a node and downstream",
      );
      console.log(
        "  workflow merge <id> --nodes a,b --repo <p> Merge parallel branches",
      );
      console.log(
        "  workflow complete <id> --repo <p> [--summary <t>]  Mark workflow done",
      );
      console.log(
        "  workflow fail <id> --reason <t> --repo <p> Mark workflow failed",
      );
      console.log(
        "  workflow list --repo <p>                   List workflows",
      );
      console.log(
        "  workflow list-roles --repo <p> [--cli <claude|codex>]  List role registry entries",
      );
      console.log(
        "  workflow status <id> --repo <p>            Get workflow status",
      );
      console.log(
        "  workflow cleanup <id> --repo <p> [--force] Clean up workflow runtime state",
      );
      console.log(
        "  worktree list --repo <p>                   List worktrees",
      );
      console.log(
        "  worktree create --repo <p> --branch <b>    Create a worktree",
      );
      console.log(
        "  worktree remove --repo <p> --path <p>      Remove a worktree",
      );
      console.log(
        "  terminal create --worktree <p> --type <t>   Create terminal",
      );
      console.log(
        "  terminal list [--worktree <p>]              List terminals",
      );
      console.log("  terminal status <id>                        Get status");
      console.log("  terminal output <id> [--lines N]            Read output");
      console.log(
        "  terminal destroy <id>                       Destroy terminal",
      );
      console.log(
        "  terminal set-title <id> <title>             Set custom title",
      );
      console.log(
        "  telemetry get --terminal <id>               Get terminal telemetry",
      );
      console.log(
        "  telemetry get --workflow <id> [--repo <p>]  Get workflow telemetry",
      );
      console.log(
        "  telemetry events --terminal <id>            List terminal telemetry events",
      );
      console.log("  diff <worktree-path> [--summary]            Get git diff");
      console.log(
        "  state                                       Full canvas state",
      );
      console.log("");
      console.log("Flags:");
      console.log("  --json    Output in JSON format");
      process.exit(1);
    }
  } catch (err: any) {
    console.error(err.error ?? err.message ?? err);
    process.exit(1);
  }
}

main();
