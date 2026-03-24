export interface UpdaterLoggerLike {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

function noop(): void {}

function getMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

export function isBrokenPipeError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "EPIPE") return true;
  }
  return /broken pipe/i.test(getMessage(error));
}

function wrapLogMethod(
  method: ((...args: unknown[]) => void) | undefined,
  receiver: unknown,
): (...args: unknown[]) => void {
  const target = method ?? noop;
  return (...args: unknown[]) => {
    try {
      Reflect.apply(target, receiver, args);
    } catch (error) {
      if (!isBrokenPipeError(error)) throw error;
    }
  };
}

export function createSafeUpdaterLogger(
  base: Partial<UpdaterLoggerLike> = console,
): UpdaterLoggerLike {
  return {
    info: wrapLogMethod(base.info, base),
    warn: wrapLogMethod(base.warn, base),
    error: wrapLogMethod(base.error, base),
    ...(base.debug ? { debug: wrapLogMethod(base.debug, base) } : {}),
  };
}

export function shouldScheduleAutoUpdateChecks(isPackaged: boolean): boolean {
  return isPackaged;
}
