const DEFAULT_MAX_REPLAY_BYTES = 512 * 1024;

export interface TerminalReplayHistory {
  append: (chunk: string) => void;
  getContent: () => string | null;
}

export function createTerminalReplayHistory(
  initialScrollback?: string,
  maxBytes = DEFAULT_MAX_REPLAY_BYTES,
): TerminalReplayHistory {
  const chunks: string[] = [];
  let totalBytes = 0;

  const trim = () => {
    while (chunks.length > 1 && totalBytes > maxBytes) {
      const removed = chunks.shift();
      if (!removed) {
        break;
      }
      totalBytes -= removed.length;
    }
  };

  const append = (chunk: string) => {
    if (chunk.length === 0) {
      return;
    }
    chunks.push(chunk);
    totalBytes += chunk.length;
    trim();
  };

  if (initialScrollback) {
    append(initialScrollback);
  }

  return {
    append,
    getContent: () => (chunks.length > 0 ? chunks.join("") : null),
  };
}
