import fs from "node:fs";
import path from "node:path";
import type { ServerEventBus } from "./event-bus.ts";

export interface PersistenceController {
  schedule(): void;
  flush(): void;
  cancel(): void;
}

interface GracefulShutdownDeps {
  host: string;
  port: number;
  version: string;
  eventBus: Pick<ServerEventBus, "emit">;
  persistence: PersistenceController;
  apiServer: {
    stop(): void | Promise<void>;
  };
  ptyManager: {
    destroyAll(): Promise<void>;
  };
  telemetryService: {
    dispose(): void;
  };
  heartbeat?: {
    stop(): void;
  } | null;
  webhookService?: {
    stop(): void;
  } | null;
  portFile: string;
  exit?: (code: number) => void;
}

function logLifecycleError(message: string, err: unknown): void {
  console.error(message, err);
}

function writeStateFile(statePath: string, getState: () => unknown): void {
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmp = `${statePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(getState(), null, 2), "utf-8");
  fs.renameSync(tmp, statePath);
}

export function createPersistenceController(
  statePath: string,
  getState: () => unknown,
  delayMs = 500,
): PersistenceController {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    writeStateFile(statePath, getState);
  };

  return {
    schedule(): void {
      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = null;
        try {
          writeStateFile(statePath, getState);
        } catch (err) {
          logLifecycleError("[headless] state save failed:", err);
        }
      }, delayMs);
    },
    flush,
    cancel(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

async function runCleanupStep(
  label: string,
  cleanup: () => void | Promise<void>,
): Promise<unknown | null> {
  try {
    await cleanup();
    return null;
  } catch (err) {
    logLifecycleError(`[headless] ${label} failed:`, err);
    return err;
  }
}

export function createGracefulShutdown(
  deps: GracefulShutdownDeps,
): (signal?: NodeJS.Signals) => Promise<void> {
  let shutdownPromise: Promise<void> | null = null;

  return (signal?: NodeJS.Signals): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      const label = signal ? ` (${signal})` : "";
      console.log(`[headless] shutting down${label}...`);

      deps.eventBus.emit("server_stopping", {
        host: deps.host,
        port: deps.port,
        version: deps.version,
        ...(signal ? { signal } : {}),
      });

      const failures: unknown[] = [];
      const recordFailure = (failure: unknown | null): void => {
        if (failure) {
          failures.push(failure);
        }
      };

      recordFailure(await runCleanupStep("state flush", () => deps.persistence.flush()));
      recordFailure(await runCleanupStep("heartbeat stop", () => deps.heartbeat?.stop()));
      recordFailure(await runCleanupStep("api server stop", () => deps.apiServer.stop()));
      recordFailure(await runCleanupStep("pty cleanup", () => deps.ptyManager.destroyAll()));
      recordFailure(await runCleanupStep("telemetry dispose", () => deps.telemetryService.dispose()));
      recordFailure(await runCleanupStep("webhook stop", () => deps.webhookService?.stop()));
      recordFailure(await runCleanupStep("port file cleanup", () => {
        try {
          fs.unlinkSync(deps.portFile);
        } catch (err) {
          const errno = err as NodeJS.ErrnoException;
          if (errno.code !== "ENOENT") {
            throw err;
          }
        }
      }));

      if (failures.length > 0) {
        if (deps.exit) {
          deps.exit(1);
          return;
        }
        throw failures[0];
      }

      console.log("[headless] shutdown complete");
      deps.exit?.(0);
    })();

    return shutdownPromise;
  };
}
