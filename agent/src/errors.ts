/**
 * Structured error classification for the agent loop.
 *
 * Unifies the duplicated isRetryable() logic from both providers into
 * a single category system that drives loop-level recovery decisions.
 */

export type ErrorCategory =
  | "retryable_rate_limit"
  | "retryable_server"
  | "prompt_too_long"
  | "media_too_large"
  | "auth_error"
  | "billing_error"
  | "fatal";

export function categorizeError(err: unknown): ErrorCategory {
  if (!(err instanceof Error)) return "fatal";

  const msg = err.message.toLowerCase();
  const status = (err as { status?: number }).status;

  if (status === 429 || msg.includes("rate limit") || msg.includes("overloaded") || msg.includes("too many requests")) {
    return "retryable_rate_limit";
  }

  // Server errors
  if (status !== undefined && (status >= 500 || status === 408 || status === 409)) {
    return "retryable_server";
  }
  if (msg.includes("connection") || msg.includes("timeout") || msg.includes("econnrefused") || msg.includes("econnreset") || msg.includes("enotfound") || msg.includes("epipe") || msg.includes("ehostunreach")) {
    return "retryable_server";
  }

  if (
    status === 413 ||
    msg.includes("prompt is too long") ||
    msg.includes("context length exceeded") ||
    msg.includes("maximum context length") ||
    msg.includes("request too large") ||
    msg.includes("content is too large")
  ) {
    return "prompt_too_long";
  }

  if (msg.includes("media_too_large") || msg.includes("file too large")) {
    return "media_too_large";
  }

  // Auth errors
  if (status === 401 || status === 403 || msg.includes("unauthorized") || msg.includes("forbidden") || msg.includes("invalid api key") || msg.includes("invalid x-api-key")) {
    return "auth_error";
  }

  // Billing errors
  if (status === 402 || msg.includes("billing") || msg.includes("quota") || msg.includes("insufficient_quota") || msg.includes("credit")) {
    return "billing_error";
  }

  return "fatal";
}

export function isRetryableCategory(category: ErrorCategory): boolean {
  return category === "retryable_rate_limit" || category === "retryable_server";
}

const BASE_DELAY_RATE_LIMIT = 2000;
const BASE_DELAY_SERVER = 500;
const MAX_DELAY = 30_000;

export interface TokenLimits {
  actual?: number;
  limit?: number;
}

const TOKEN_LIMIT_PATTERNS = [
  /maximum context length is (\d+).*?requested (\d+)/i,
  /prompt is too long:\s*(\d+)\s*tokens?\s*>\s*(\d+)/i,
  /context length exceeded.*?(\d+).*?(\d+)/i,
] as const;

export function parseTokenLimits(err: unknown): TokenLimits | undefined {
  if (!(err instanceof Error)) return undefined;
  const msg = err.message;

  for (const pattern of TOKEN_LIMIT_PATTERNS) {
    const match = msg.match(pattern);
    if (match) {
      const n1 = parseInt(match[1], 10);
      const n2 = parseInt(match[2], 10);
      // First pattern: limit then actual; others: actual then limit
      if (pattern === TOKEN_LIMIT_PATTERNS[0]) {
        return { limit: n1, actual: n2 };
      }
      return { actual: n1, limit: n2 };
    }
  }

  return undefined;
}

export function getRetryDelay(category: ErrorCategory, attempt: number): number {
  const base = category === "retryable_rate_limit" ? BASE_DELAY_RATE_LIMIT : BASE_DELAY_SERVER;
  const exponential = Math.min(base * 2 ** (attempt - 1), MAX_DELAY);
  const jitter = exponential * (0.75 + Math.random() * 0.5);
  return jitter;
}
