import crypto from "node:crypto";

export interface JsonNotificationRequest {
  url: string;
  label: string;
  payload: unknown;
  headers?: HeadersInit;
}

export interface JsonNotificationSender {
  sendJson(input: JsonNotificationRequest): void;
  stop(): void;
}

type FetchLike = typeof fetch;
type TimerHandle = ReturnType<typeof setTimeout>;

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_RETRY_DELAYS_MS = [1_000, 4_000, 16_000] as const;

function mergeHeaders(
  base: HeadersInit,
  override: HeadersInit | undefined,
): Record<string, string> {
  const headers = new Headers(base);
  if (override) {
    const next = new Headers(override);
    for (const [key, value] of next.entries()) {
      headers.set(key, value);
    }
  }
  return Object.fromEntries(headers.entries());
}

export class NotificationTransport implements JsonNotificationSender {
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly logger: Pick<Console, "error">;
  private readonly pendingTimers = new Set<TimerHandle>();
  private readonly secret: string | undefined;
  private stopped = false;

  constructor(options?: {
    secret?: string;
    fetchImpl?: FetchLike;
    requestTimeoutMs?: number;
    retryDelaysMs?: readonly number[];
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
    logger?: Pick<Console, "error">;
  }) {
    this.secret = options?.secret;
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.requestTimeoutMs =
      options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.retryDelaysMs = options?.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.setTimer = options?.setTimer ?? setTimeout;
    this.clearTimer = options?.clearTimer ?? clearTimeout;
    this.logger = options?.logger ?? console;
  }

  sendJson(input: JsonNotificationRequest): void {
    if (this.stopped) {
      return;
    }

    const body = JSON.stringify(input.payload);
    const headers = mergeHeaders(
      {
        "Content-Type": "application/json",
      },
      input.headers,
    );

    if (this.secret) {
      headers["X-Webhook-Signature"] = crypto
        .createHmac("sha256", this.secret)
        .update(body)
        .digest("hex");
    }

    void this.deliver(
      {
        url: input.url,
        label: input.label,
        body,
        headers,
      },
      0,
    );
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.pendingTimers) {
      this.clearTimer(timer);
    }
    this.pendingTimers.clear();
  }

  private async deliver(
    request: {
      url: string;
      label: string;
      body: string;
      headers: Record<string, string>;
    },
    attempt: number,
  ): Promise<void> {
    if (this.stopped) {
      return;
    }

    try {
      const response = await this.fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      const maxAttempts = this.retryDelaysMs.length + 1;
      this.logger.error(
        `[notification] ${request.label} attempt ${attempt + 1}/${maxAttempts} failed:`,
        error instanceof Error ? error.message : error,
      );

      if (attempt >= this.retryDelaysMs.length || this.stopped) {
        return;
      }

      const timer = this.setTimer(() => {
        this.pendingTimers.delete(timer);
        void this.deliver(request, attempt + 1);
      }, this.retryDelaysMs[attempt]);
      this.pendingTimers.add(timer);
    }
  }
}
