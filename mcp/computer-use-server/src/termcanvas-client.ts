import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REQUEST_TIMEOUT_MS = 30_000;

function normalizeBasePath(pathname: string): string {
  if (!pathname || pathname === "/") return "";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function defaultPortFilePath(): string {
  const instance = process.env.TERMCANVAS_INSTANCE === "dev" ? "dev" : "prod";
  const dir = instance === "dev" ? ".termcanvas-dev" : ".termcanvas";
  return path.join(os.homedir(), dir, "port");
}

function resolveBaseUrl(): string | null {
  const envUrl = process.env.TERMCANVAS_URL?.trim();
  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      return `${parsed.protocol}//${parsed.host}${normalizeBasePath(parsed.pathname)}`;
    } catch {
      return null;
    }
  }

  const envHost = process.env.TERMCANVAS_HOST?.trim();
  const envPort = process.env.TERMCANVAS_PORT?.trim();
  if (envHost && envPort) {
    return `http://${envHost}:${envPort}`;
  }

  const portFile =
    process.env.TERMCANVAS_PORT_FILE?.trim() || defaultPortFilePath();
  try {
    const port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0].trim());
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    return `http://127.0.0.1:${port}`;
  } catch {
    return null;
  }
}

export class TermCanvasClient {
  async get(pathname: string): Promise<unknown> {
    return this.request("GET", pathname);
  }

  async post(pathname: string, body?: unknown): Promise<unknown> {
    return this.request("POST", pathname, body);
  }

  private async request(
    method: string,
    pathname: string,
    body?: unknown,
  ): Promise<unknown> {
    const baseUrl = resolveBaseUrl();
    if (!baseUrl) {
      throw new Error(
        "TermCanvas API is not available. Start this agent from a TermCanvas terminal.",
      );
    }

    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as unknown : null;
    if (!response.ok) {
      const message =
        typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof data.error === "string"
          ? data.error
          : `TermCanvas API returned HTTP ${response.status}`;
      throw new Error(message);
    }
    return data;
  }
}
