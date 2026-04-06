import http from "http";
import https from "https";
import fs from "fs";
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
    const raw = fs.readFileSync(portFile, "utf-8").trim();
    // Port file may be JSON with { port, token } or legacy plain port number
    let parsedPort: number;
    try {
      const data = JSON.parse(raw);
      parsedPort = data.port;
      if (data.token && !resolvedApiToken) {
        resolvedApiToken = data.token;
      }
    } catch {
      parsedPort = parseInt(raw, 10);
    }
    return {
      protocol: "http:",
      hostname: "127.0.0.1",
      port: parsedPort,
      basePath: "",
    };
  } catch {
    console.error(`TermCanvas is not running (no port file found at ${portFile}).`);
    process.exit(1);
  }
}

let resolvedApiToken = process.env.TERMCANVAS_API_TOKEN?.trim();

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
    if (resolvedApiToken) headers["Authorization"] = `Bearer ${resolvedApiToken}`;

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
      if (command === "run") {
        const taskIdx = rest.indexOf("--task");
        const repoIdx = rest.indexOf("--repo");
        const worktreeIdx = rest.indexOf("--worktree");
        const templateIdx = rest.indexOf("--template");
        const allTypeIdx = rest.indexOf("--all-type");
        const plannerTypeIdx = rest.indexOf("--planner-type");
        const implementerTypeIdx = rest.indexOf("--implementer-type");
        const evaluatorTypeIdx = rest.indexOf("--evaluator-type");
        const timeoutIdx = rest.indexOf("--timeout-minutes");
        const retriesIdx = rest.indexOf("--max-retries");
        const task = taskIdx >= 0 ? rest[taskIdx + 1] : undefined;
        const repo = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
        const worktree = worktreeIdx >= 0 ? rest[worktreeIdx + 1] : undefined;
        const template = templateIdx >= 0 ? rest[templateIdx + 1] : undefined;
        const allType = allTypeIdx >= 0 ? rest[allTypeIdx + 1] : undefined;
        const plannerType = plannerTypeIdx >= 0 ? rest[plannerTypeIdx + 1] : undefined;
        const implementerType = implementerTypeIdx >= 0 ? rest[implementerTypeIdx + 1] : undefined;
        const evaluatorType = evaluatorTypeIdx >= 0 ? rest[evaluatorTypeIdx + 1] : undefined;
        const timeoutMinutes = timeoutIdx >= 0 ? parseInt(rest[timeoutIdx + 1], 10) : undefined;
        const maxRetries = retriesIdx >= 0 ? parseInt(rest[retriesIdx + 1], 10) : undefined;
        const autoApprove = !rest.includes("--no-auto-approve");
        const approvePlan = rest.includes("--approve-plan");

        if (!task) {
          console.error("--task is required");
          process.exit(1);
        }
        if (!repo) {
          console.error("--repo is required");
          process.exit(1);
        }

        const result = await request("POST", "/workflow/run", {
          task,
          repo,
          ...(worktree ? { worktree } : {}),
          ...(template ? { template } : {}),
          ...(allType ? { allType } : {}),
          ...(plannerType ? { plannerType } : {}),
          ...(implementerType ? { implementerType } : {}),
          ...(evaluatorType ? { evaluatorType } : {}),
          ...(timeoutMinutes ? { timeoutMinutes } : {}),
          ...(maxRetries !== undefined ? { maxRetries } : {}),
          autoApprove,
          approvePlan,
        });
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log(`Started workflow ${result.workflow.id}.`);
      } else if (command === "list") {
        const repoIdx = rest.indexOf("--repo");
        const repo = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
        if (!repo) {
          console.error("--repo is required");
          process.exit(1);
        }
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
          console.log(
            `${workflow.id}  ${workflow.status}  ${workflow.current_handoff_id}  ${workflow.updated_at}`,
          );
        }
      } else if (
        (command === "status" || command === "tick" || command === "retry" || command === "cleanup" || command === "watch") &&
        rest[0]
      ) {
        const workflowId = rest[0];
        const repoIdx = rest.indexOf("--repo");
        const repo = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
        if (!repo) {
          console.error("--repo is required");
          process.exit(1);
        }

        if (command === "status") {
          const result = await request(
            "GET",
            `/workflow/${encodeURIComponent(workflowId)}?repo=${encodeURIComponent(repo)}`,
          );
          if (jsonFlag) console.log(JSON.stringify(result, null, 2));
          else console.log(`${result.workflow.status}  ${result.workflow.current_handoff_id}`);
        } else if (command === "tick") {
          const result = await request(
            "POST",
            `/workflow/${encodeURIComponent(workflowId)}/tick`,
            { repo },
          );
          if (jsonFlag) console.log(JSON.stringify(result, null, 2));
          else console.log(`${result.workflow.status}  ${result.workflow.current_handoff_id}`);
        } else if (command === "retry") {
          const result = await request(
            "POST",
            `/workflow/${encodeURIComponent(workflowId)}/retry`,
            { repo },
          );
          if (jsonFlag) console.log(JSON.stringify(result, null, 2));
          else console.log(`${result.workflow.status}  ${result.workflow.current_handoff_id}`);
        } else if (command === "cleanup") {
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
          const intervalIdx = rest.indexOf("--interval-ms");
          const timeoutIdx = rest.indexOf("--timeout-ms");
          const intervalMs = intervalIdx >= 0 ? parseInt(rest[intervalIdx + 1], 10) : 30_000;
          const timeoutMs = timeoutIdx >= 0 ? parseInt(rest[timeoutIdx + 1], 10) : 3_600_000;
          const startedAt = Date.now();
          let result = await request(
            "POST",
            `/workflow/${encodeURIComponent(workflowId)}/tick`,
            { repo },
          );
          while (
            result.workflow.status !== "completed" &&
            result.workflow.status !== "failed" &&
            result.workflow.status !== "waiting_for_approval" &&
            Date.now() - startedAt < timeoutMs
          ) {
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
            result = await request(
              "POST",
              `/workflow/${encodeURIComponent(workflowId)}/tick`,
              { repo },
            );
          }
          if (jsonFlag) console.log(JSON.stringify(result, null, 2));
          else console.log(`${result.workflow.status}  ${result.workflow.current_handoff_id}`);
        }
      } else {
        console.log(
          "Usage: termcanvas workflow <run|list|status|tick|watch|retry|cleanup> [args]",
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
        const handoffIdx = rest.indexOf("--handoff-id");
        const repoIdx = rest.indexOf("--repo");
        const autoApprove = rest.includes("--auto-approve");
        const worktree = wtIdx >= 0 ? rest[wtIdx + 1] : undefined;
        const type = typeIdx >= 0 ? rest[typeIdx + 1] : "shell";
        const prompt = promptIdx >= 0 ? rest[promptIdx + 1] : undefined;
        const parentTerminalId = parentIdx >= 0 ? rest[parentIdx + 1] : undefined;
        const workflowId = workflowIdx >= 0 ? rest[workflowIdx + 1] : undefined;
        const handoffId = handoffIdx >= 0 ? rest[handoffIdx + 1] : undefined;
        const repoPath = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
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
          ...(handoffId ? { handoffId } : {}),
          ...(repoPath ? { repoPath } : {}),
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
    } else if (group === "state") {
      const state = await request("GET", "/state");
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(
        "Usage: termcanvas <project|workflow|worktree|terminal|telemetry|diff|state> <command> [args]",
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
        "  workflow run --task <t> --repo <p>         Start a workflow",
      );
      console.log(
        "  workflow list --repo <p>                   List workflows",
      );
      console.log(
        "  workflow status <id> --repo <p>            Get workflow status",
      );
      console.log(
        "  workflow tick <id> --repo <p>              Advance one workflow tick",
      );
      console.log(
        "  workflow watch <id> --repo <p>             Poll workflow until terminal state",
      );
      console.log(
        "  workflow retry <id> --repo <p>             Retry failed workflow",
      );
      console.log(
        "  workflow cleanup <id> --repo <p>           Clean up workflow runtime state",
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
