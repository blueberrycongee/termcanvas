import http from "http";
import fs from "fs";
import path from "path";
import os from "os";

const PORT_FILE = path.join(os.homedir(), ".termcanvas", "port");

function getPort(): number {
  try {
    return parseInt(fs.readFileSync(PORT_FILE, "utf-8").trim(), 10);
  } catch {
    console.error("TermCanvas is not running (no port file found).");
    process.exit(1);
  }
}

function request(method: string, urlPath: string, body?: any): Promise<any> {
  const port = getPort();
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data
            ? { "Content-Length": String(Buffer.byteLength(data)) }
            : {}),
        },
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => (responseBody += chunk));
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
    req.on("error", (err) => {
      console.error("Failed to connect to TermCanvas:", err.message);
      process.exit(1);
    });
    if (data) req.write(data);
    req.end();
  });
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
    } else if (group === "terminal") {
      if (command === "create") {
        const wtIdx = rest.indexOf("--worktree");
        const typeIdx = rest.indexOf("--type");
        const promptIdx = rest.indexOf("--prompt");
        const parentIdx = rest.indexOf("--parent-terminal");
        const autoApprove = rest.includes("--auto-approve");
        const worktree = wtIdx >= 0 ? rest[wtIdx + 1] : undefined;
        const type = typeIdx >= 0 ? rest[typeIdx + 1] : "shell";
        const prompt = promptIdx >= 0 ? rest[promptIdx + 1] : undefined;
        const parentTerminalId = parentIdx >= 0 ? rest[parentIdx + 1] : undefined;
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
      } else if (command === "input" && rest[0] && rest[1]) {
        const result = await request("POST", `/terminal/${rest[0]}/input`, { text: rest[1] });
        if (jsonFlag) console.log(JSON.stringify(result, null, 2));
        else console.log("Sent.");
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
      } else {
        console.log(
          "Usage: termcanvas terminal <create|list|input|status|output|destroy|set-title> [args]",
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
        "Usage: termcanvas <project|terminal|diff|state> <command> [args]",
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
        "  terminal create --worktree <p> --type <t>   Create terminal",
      );
      console.log(
        "  terminal list [--worktree <p>]              List terminals",
      );
      console.log("  terminal input <id> <text>                  Send input");
      console.log("  terminal status <id>                        Get status");
      console.log("  terminal output <id> [--lines N]            Read output");
      console.log(
        "  terminal destroy <id>                       Destroy terminal",
      );
      console.log(
        "  terminal set-title <id> <title>             Set custom title",
      );
      console.log("  diff <worktree-path> [--summary]            Get git diff");
      console.log(
        "  state                                       Full canvas state",
      );
      console.log("");
      console.log("Flags:");
      console.log("  --json    Output in JSON format");
    }
  } catch (err: any) {
    console.error(err.error ?? err.message ?? err);
    process.exit(1);
  }
}

main();
