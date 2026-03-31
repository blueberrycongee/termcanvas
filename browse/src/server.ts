import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { BROWSE_DIR, STATE_FILE, IDLE_TIMEOUT_MS } from "./config.ts";
import type { ServerState } from "./config.ts";
import type { Browser, Page } from "playwright";

export interface CommandRequest {
  command: string;
  args: string[];
}

export interface CommandResult {
  ok: boolean;
  output: string;
  error?: string;
}

export interface BrowseContext {
  browser: Browser;
  page: Page;
  consoleMessages: string[];
  refMap: Map<string, { role: string; name: string; index: number }>;
  setPage: (p: Page) => void;
  listenedPages: Set<Page>;
}

export type CommandHandler = (
  page: Page,
  args: string[],
  context: BrowseContext,
) => Promise<CommandResult>;

let commandRegistry: Map<string, CommandHandler> | null = null;

export function setCommandRegistry(registry: Map<string, CommandHandler>) {
  commandRegistry = registry;
}

export async function startServer(port = 0): Promise<{
  server: http.Server;
  state: ServerState;
  shutdown: () => Promise<void>;
}> {
  const token = crypto.randomBytes(16).toString("hex");
  let idleTimer: ReturnType<typeof setTimeout>;
  let browser: Browser | null = null;
  let activePage: Page | null = null;
  const consoleMessages: string[] = [];
  const refMap = new Map<string, { role: string; name: string; index: number }>();
  const listenedPages = new Set<Page>();

  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => shutdown(), IDLE_TIMEOUT_MS);
  };

  function attachConsoleListener(page: Page) {
    if (listenedPages.has(page)) return;
    listenedPages.add(page);
    page.on("console", (msg) => {
      consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
      if (consoleMessages.length > 200) consoleMessages.shift();
    });
  }

  async function ensureBrowser(): Promise<{ browser: Browser; page: Page }> {
    if (!browser) {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      activePage = await context.newPage();
      attachConsoleListener(activePage);
    }
    return { browser, page: activePage! };
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      resetIdle();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, pid: process.pid }));
      return;
    }

    if (req.method === "POST" && req.url === "/command") {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return;
      }

      let body = "";
      for await (const chunk of req) body += chunk;

      let parsed: CommandRequest;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid JSON" }));
        return;
      }

      if (parsed.command === "stop") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, output: "shutting down" }));
        shutdown();
        return;
      }

      if (!commandRegistry) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ ok: false, error: "no command registry loaded" }),
        );
        return;
      }

      const handler = commandRegistry.get(parsed.command);
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: `unknown command: ${parsed.command}`,
          }),
        );
        return;
      }

      try {
        const { browser: b, page } = await ensureBrowser();
        const context: BrowseContext = {
          browser: b,
          page,
          consoleMessages,
          refMap,
          setPage: (p: Page) => {
            activePage = p;
          },
          listenedPages,
        };
        const result = await handler(page, parsed.args, context);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: message }));
      }
      resetIdle();
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  const shutdown = async () => {
    clearTimeout(idleTimer);
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
    server.close();
    try {
      fs.unlinkSync(STATE_FILE);
    } catch {}
  };

  process.on("SIGTERM", () => shutdown());
  process.on("SIGINT", () => shutdown());

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const state: ServerState = {
        port: addr.port,
        token,
        pid: process.pid,
      };

      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });

      resetIdle();
      resolve({ server, state, shutdown });
    });
  });
}
