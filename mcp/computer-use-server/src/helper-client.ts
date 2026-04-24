const DEFAULT_PORT = 17394;
const REQUEST_TIMEOUT_MS = 30_000;

export class HelperClient {
  private baseUrl: string;
  private token: string;

  constructor() {
    const port = process.env.TERMCANVAS_CU_PORT
      ? parseInt(process.env.TERMCANVAS_CU_PORT, 10)
      : DEFAULT_PORT;
    this.token = process.env.TERMCANVAS_CU_TOKEN ?? "";
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

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
    const url = `${this.baseUrl}/${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers["X-Token"] = this.token;
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
          `Computer Use helper is not running at ${this.baseUrl}. ` +
            "Make sure TermCanvas is open and Computer Use is enabled in Settings.",
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
