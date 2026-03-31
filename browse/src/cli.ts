import fs from "node:fs";
import { spawn } from "node:child_process";
import { STATE_FILE, BROWSE_DIR } from "./config.ts";
import type { ServerState } from "./config.ts";
import { startServer, setCommandRegistry } from "./server.ts";
import { createCommandRegistry } from "./commands/index.ts";

function readState(): ServerState | null {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

async function isServerAlive(state: ServerState): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    const body = await res.json();
    return body.ok === true;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<ServerState> {
  const existing = readState();
  if (existing && (await isServerAlive(existing))) {
    return existing;
  }

  // Spawn a detached server process using the current script with start-server
  const child = spawn(
    process.execPath,
    [process.argv[1], "start-server"],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    },
  );
  child.unref();

  // Wait for state file to appear
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const state = readState();
    if (state && (await isServerAlive(state))) return state;
  }
  throw new Error("failed to start browse server");
}

async function sendCommand(
  state: ServerState,
  command: string,
  args: string[],
): Promise<{ ok: boolean; output: string; error?: string }> {
  const res = await fetch(`http://127.0.0.1:${state.port}/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
    },
    body: JSON.stringify({ command, args }),
  });
  return res.json();
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "help") {
    console.log(
      "Usage: browse <command> [args...]\n\nCommands: goto, back, reload, wait, url, snapshot, text, links, console, click, fill, select, scroll, press, hover, screenshot, tabs, tab, cookies, status, stop",
    );
    return;
  }

  if (command === "status") {
    const state = readState();
    if (!state) {
      console.log("browse server is not running");
      return;
    }
    if (await isServerAlive(state)) {
      console.log(
        `browse server running on port ${state.port} (pid ${state.pid})`,
      );
    } else {
      console.log("browse server state file exists but server is not responding");
      try {
        fs.unlinkSync(STATE_FILE);
      } catch {}
    }
    return;
  }

  // For "start-server" internal command, run inline
  if (command === "start-server") {
    setCommandRegistry(createCommandRegistry());
    await startServer();
    return;
  }

  const state = await ensureServer();
  const result = await sendCommand(state, command, args);

  if (result.ok) {
    if (result.output) console.log(result.output);
  } else {
    console.error(result.error || "command failed");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
