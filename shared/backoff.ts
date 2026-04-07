/**
 * Exponential backoff with jitter and generic retry wrapper.
 *
 * Default parameters match AWS-style retry best practices:
 * - Base delay 500ms, max cap 30s, 2x multiplier
 * - ±25% jitter to prevent thundering herd
 */

export interface BackoffOptions {
  /** Base delay in ms. Default: 500 */
  baseMs?: number;
  /** Maximum delay cap in ms. Default: 30000 */
  maxMs?: number;
  /** Growth factor per attempt. Default: 2 */
  multiplier?: number;
  /** Jitter range as fraction of delay. Default: 0.25 (±25%) */
  jitterFraction?: number;
}

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Backoff configuration. Uses defaults if omitted. */
  backoff?: BackoffOptions;
  /** Return true for errors that should trigger a retry. Default: always retry. */
  retryIf?: (error: unknown) => boolean;
}

/**
 * Compute the delay for a given attempt number (1-based).
 * Formula: min(base * multiplier^(attempt-1), max) ± jitter
 */
export function computeBackoff(attempt: number, options: BackoffOptions = {}): number {
  const {
    baseMs = 500,
    maxMs = 30000,
    multiplier = 2,
    jitterFraction = 0.25,
  } = options;

  const delay = Math.min(baseMs * Math.pow(multiplier, attempt - 1), maxMs);
  const jitter = delay * jitterFraction * (Math.random() * 2 - 1);
  return Math.max(50, Math.round(delay + jitter));
}

/**
 * Generic retry wrapper with exponential backoff and jitter.
 *
 * @param fn - Async function to retry
 * @param options - Retry and backoff configuration
 * @returns The result of fn() on success
 * @throws The last error after all attempts exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, backoff, retryIf } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || (retryIf && !retryIf(error))) break;

      const delay = computeBackoff(attempt, backoff);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
