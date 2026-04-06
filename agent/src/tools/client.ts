import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
  if (!pathname || pathname === "/") return "";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function buildRequestPath(basePath: string, urlPath: string): string {
  const [pathname, search = ""] = urlPath.split("?");
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const resolvedPath = `${basePath}${normalizedPath}`;
  return search ? `${resolvedPath}?${search}` : resolvedPath;
}

function resolvePortFile(env: Record<string, string | undefined>): string {
  const explicit = env.TERMCANVAS_PORT_FILE?.trim();
  if (explicit) return explicit;
  const instanceRaw = env.TERMCANVAS_INSTANCE?.trim().toLowerCase();
  const isDev = instanceRaw === "dev" || instanceRaw === "development";
  const dataDir = path.join(os.homedir(), isDev ? ".termcanvas-dev" : ".termcanvas");
  return path.join(dataDir, "port");
}

let cachedToken: string | undefined;

function resolveConnection(env: Record<string, string | undefined>): ConnectionTarget {
  const envUrl = env.TERMCANVAS_URL?.trim();
  if (envUrl) {
    const parsed = new URL(envUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    const port = parsed.port
      ? parseInt(parsed.port, 10)
      : parsed.protocol === "https:" ? 443 : 80;
    return {
      protocol: parsed.protocol as "http:" | "https:",
      hostname: parsed.hostname,
      port,
      basePath: normalizeBasePath(parsed.pathname),
    };
  }

  const envHost = env.TERMCANVAS_HOST?.trim();
  const envPort = env.TERMCANVAS_PORT?.trim();
  if (envHost && envPort) {
    return { protocol: "http:", hostname: envHost, port: parseInt(envPort, 10), basePath: "" };
  }

  const portFile = resolvePortFile(env);
  try {
    const raw = fs.readFileSync(portFile, "utf-8").trim();
    // Port file may be JSON with { port, token } or legacy plain port number
    let parsedPort: number;
    try {
      const data = JSON.parse(raw);
      parsedPort = data.port;
      if (data.token) cachedToken = data.token;
    } catch {
      parsedPort = parseInt(raw, 10);
    }
    return { protocol: "http:", hostname: "127.0.0.1", port: parsedPort, basePath: "" };
  } catch {
    throw new Error(`TermCanvas is not running (no port file at ${portFile})`);
  }
}

function requestOnce(
  target: ConnectionTarget,
  method: string,
  urlPath: string,
  token: string | undefined,
  body?: unknown,
): Promise<unknown> {
  const { protocol, hostname, port, basePath } = target;
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (data) headers["Content-Length"] = String(Buffer.byteLength(data));
    if (token) headers["Authorization"] = `Bearer ${token}`;

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
            reject(new Error(responseBody || `HTTP ${res.statusCode}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("ETIMEDOUT")));
    req.on("error", (err) => reject(err));
    if (data) req.write(data);
    req.end();
  });
}

async function requestWithRetry(
  target: ConnectionTarget,
  method: string,
  urlPath: string,
  token: string | undefined,
  body?: unknown,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await requestOnce(target, method, urlPath, token, body);
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
  throw lastError;
}

export class TermCanvasClient {
  private target: ConnectionTarget | null = null;

  private resolve(): ConnectionTarget {
    if (!this.target) {
      this.target = resolveConnection(process.env);
    }
    return this.target;
  }

  private getToken(): string | undefined {
    return process.env.TERMCANVAS_API_TOKEN?.trim() || cachedToken || undefined;
  }

  async request(method: string, urlPath: string, body?: unknown): Promise<unknown> {
    return requestWithRetry(this.resolve(), method, urlPath, this.getToken(), body);
  }
}

let cachedClient: TermCanvasClient | null = null;

export function getClient(): TermCanvasClient {
  if (!cachedClient) cachedClient = new TermCanvasClient();
  return cachedClient;
}

interface BrowseState {
  port: number;
  token: string;
}

export class BrowseClient {
  private state: BrowseState | null = null;

  private resolve(): BrowseState {
    if (this.state) return this.state;

    const envUrl = process.env.BROWSE_URL?.trim();
    if (envUrl) {
      const parsed = new URL(envUrl);
      const port = parsed.port ? parseInt(parsed.port, 10) : 80;
      this.state = { port, token: process.env.BROWSE_TOKEN?.trim() ?? "" };
      return this.state;
    }

    const stateFile = path.join(os.homedir(), ".termcanvas", "browse", "browse.json");
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as BrowseState;
      this.state = { port: raw.port, token: raw.token };
      return this.state;
    } catch {
      throw new Error(`Browse server is not running (no state file at ${stateFile})`);
    }
  }

  async command(cmd: string, args: string[] = []): Promise<unknown> {
    const { port, token } = this.resolve();
    const target: ConnectionTarget = {
      protocol: "http:",
      hostname: "127.0.0.1",
      port,
      basePath: "",
    };
    return requestWithRetry(target, "POST", "/command", token, {
      command: cmd,
      args,
      cwd: process.cwd(),
    });
  }
}

let cachedBrowseClient: BrowseClient | null = null;

export function getBrowseClient(): BrowseClient {
  if (!cachedBrowseClient) cachedBrowseClient = new BrowseClient();
  return cachedBrowseClient;
}
