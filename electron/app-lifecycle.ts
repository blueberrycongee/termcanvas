export interface AppCloseCleanupDeps {
  outputBatcher: { dispose(): void };
  ptyManager: { destroyAll(): Promise<void> };
  gitWatcher: { unwatchAll(): void };
  fileTreeWatcher: { unwatchAll(): void };
  sessionWatcher: { unwatchAll(): void };
  telemetryService: { dispose(): void };
  agentService: { dispose(): Promise<void> };
}

export function createAppCloseCleanup(deps: AppCloseCleanupDeps): () => Promise<void> {
  let cleanupPromise: Promise<void> | null = null;

  return async (): Promise<void> => {
    if (cleanupPromise) {
      return cleanupPromise;
    }

    cleanupPromise = (async () => {
      deps.outputBatcher.dispose();
      await deps.ptyManager.destroyAll();
      deps.gitWatcher.unwatchAll();
      deps.fileTreeWatcher.unwatchAll();
      deps.sessionWatcher.unwatchAll();
      deps.telemetryService.dispose();
      await deps.agentService.dispose();
    })();

    return cleanupPromise;
  };
}
