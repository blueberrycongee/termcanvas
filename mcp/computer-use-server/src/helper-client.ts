import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_PORT = 17394;
const REQUEST_TIMEOUT_MS = 30_000;

export interface HelperConnection {
  port: number;
  token: string;
  stateFilePath: string;
}

function defaultStateFilePath(): string {
  return path.join(os.homedir(), ".termcanvas", "computer-use", "state.json");
}

function parsePort(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return null;
  }
  return parsed;
}

export function resolveHelperConnection(
  env: NodeJS.ProcessEnv = process.env,
  readFileSync: (
    file: string,
    encoding: BufferEncoding,
  ) => string = fs.readFileSync,
): HelperConnection {
  const stateFilePath =
    env.TERMCANVAS_COMPUTER_USE_STATE_FILE?.trim() || defaultStateFilePath();

  try {
    const data = JSON.parse(readFileSync(stateFilePath, "utf-8")) as {
      enabled?: unknown;
      port?: unknown;
      token?: unknown;
    };
    const statePort = parsePort(data.port);
    if (
      data.enabled !== false &&
      statePort !== null &&
      typeof data.token === "string" &&
      data.token.length > 0
    ) {
      return {
        port: statePort,
        token: data.token,
        stateFilePath,
      };
    }
  } catch {
    // Missing or invalid state is expected when Computer Use is disabled.
  }

  return {
    port: parsePort(env.TERMCANVAS_CU_PORT) ?? DEFAULT_PORT,
    token: env.TERMCANVAS_CU_TOKEN ?? "",
    stateFilePath,
  };
}

export class HelperClient {
  async get(endpoint: string): Promise<unknown> {
    return this.request("GET", endpoint);
  }

  async post(endpoint: string, body?: unknown): Promise<unknown> {
    return this.request("POST", endpoint, body);
  }

  private async request(
    method: string,
    endpoint: string,
    body?: unknown,
  ): Promise<unknown> {
    const connection = resolveHelperConnection();
    const baseUrl = `http://127.0.0.1:${connection.port}`;
    const url = `${baseUrl}/${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (connection.token) {
      headers["X-Token"] = connection.token;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : String(err);
      if (
        msg.includes("ECONNREFUSED") ||
        msg.includes("fetch failed")
      ) {
        throw new Error(
          `Computer Use helper is not running at ${baseUrl}. ` +
            "Call the setup tool to start Computer Use and request macOS permissions.",
        );
      }
      throw new Error(`Helper request failed: ${msg}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Helper returned HTTP ${response.status}: ${text}`,
      );
    }

    return response.json();
  }
}
