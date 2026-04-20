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
  cwd?: string;
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
  cwd: string;
  pushConsoleMessage: (msg: string) => void;
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
  let isShuttingDown = false;
  const consoleMessages: string[] = [];
  const refMap = new Map<string, { role: string; name: string; index: number }>();
  const listenedPages = new Set<Page>();

  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { shutdown().catch(() => {}); }, IDLE_TIMEOUT_MS);
  };

  function pushConsoleMessage(msg: string) {
    consoleMessages.push(msg);
    if (consoleMessages.length > 200) consoleMessages.shift();
  }

  function attachConsoleListener(page: Page) {
    if (listenedPages.has(page)) return;
    listenedPages.add(page);
    page.on("console", (msg) => {
      pushConsoleMessage(`[${msg.type()}] ${msg.text()}`);
    });
  }

  function resetBrowser() {
    browser = null;
    activePage = null;
    listenedPages.clear();
    refMap.clear();
  }

  async function ensureBrowser(): Promise<{ browser: Browser; page: Page }> {
    if (!browser) {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({ headless: true });
      browser.on("disconnected", () => {
        resetBrowser();
      });
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

      let b: Browser;
      let page: Page;
      try {
        ({ browser: b, page } = await ensureBrowser());
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const hint = message.includes("Executable doesn't exist")
          ? "Chromium is not installed. Run: pnpm exec playwright install chromium"
          : `failed to start browser: ${message}`;
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: hint }));
        resetIdle();
        return;
      }

      const context: BrowseContext = {
        browser: b,
        page,
        consoleMessages,
        refMap,
        setPage: (p: Page) => {
          activePage = p;
        },
        listenedPages,
        cwd: parsed.cwd || process.cwd(),
        pushConsoleMessage,
      };

      try {
        const result = await handler(page, parsed.args, context);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const isTimeout = message.includes("Timeout") || message.includes("exceeded");
        const isDisconnected = message.includes("Target closed") || message.includes("Browser closed");
        const status = isDisconnected ? 503 : 200;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: false,
          error: isTimeout
            ? `timeout: ${message}`
            : isDisconnected
              ? `browser disconnected: ${message}`
              : message,
        }));
      }
      resetIdle();
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    clearTimeout(idleTimer);
    if (browser) {
      await browser.close().catch(() => {});
      resetBrowser();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      fs.unlinkSync(STATE_FILE);
    } catch {}
    process.exit(0);
  };

  process.on("SIGTERM", () => { shutdown().catch(() => process.exit(1)); });
  process.on("SIGINT", () => { shutdown().catch(() => process.exit(1)); });

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
