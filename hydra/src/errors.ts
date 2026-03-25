export interface HydraFailureLog {
  error_code: string;
  stage: string;
  ids: Record<string, string>;
  message: string;
}

export interface HydraErrorOptions {
  errorCode: string;
  stage: string;
  ids?: Record<string, string | null | undefined>;
}

function normalizeIds(
  ids: Record<string, string | null | undefined> | undefined,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!ids) return normalized;

  for (const [key, value] of Object.entries(ids)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    normalized[key] = value;
  }

  return normalized;
}

export class HydraError extends Error {
  readonly errorCode: string;
  readonly stage: string;
  readonly ids: Record<string, string>;

  constructor(message: string, options: HydraErrorOptions) {
    super(message);
    this.name = "HydraError";
    this.errorCode = options.errorCode;
    this.stage = options.stage;
    this.ids = normalizeIds(options.ids);
  }
}

export function toFailureLog(
  error: unknown,
  fallback: HydraErrorOptions,
): HydraFailureLog {
  if (error instanceof HydraError) {
    return {
      error_code: error.errorCode,
      stage: error.stage,
      ids: error.ids,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      error_code: fallback.errorCode,
      stage: fallback.stage,
      ids: normalizeIds(fallback.ids),
      message: error.message,
    };
  }

  return {
    error_code: fallback.errorCode,
    stage: fallback.stage,
    ids: normalizeIds(fallback.ids),
    message: String(error),
  };
}

export function writeFailureLog(
  error: unknown,
  fallback: HydraErrorOptions,
  writer: (message: string) => void = console.error,
): HydraFailureLog {
  const payload = toFailureLog(error, fallback);
  writer(JSON.stringify(payload));
  return payload;
}
