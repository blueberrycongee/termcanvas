import type { SessionInfo } from "../shared/sessions.ts";

export function buildSessionHistoryScope(
  sessions: SessionInfo[],
): Map<string, string> {
  const scope = new Map<string, string>();
  for (const session of sessions) {
    if (!session.filePath || !session.projectDir) continue;
    scope.set(session.filePath, session.projectDir);
  }
  return scope;
}

export function diffSessionHistoryScopes(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): { projectDirs: string[]; invalidatedFilePaths: string[] } {
  const changedProjectDirs = new Set<string>();
  const invalidatedFilePaths = new Set<string>();

  for (const [filePath, projectDir] of previous) {
    const nextProjectDir = next.get(filePath);
    if (!nextProjectDir) {
      changedProjectDirs.add(projectDir);
      invalidatedFilePaths.add(filePath);
      continue;
    }
    if (nextProjectDir !== projectDir) {
      changedProjectDirs.add(projectDir);
      changedProjectDirs.add(nextProjectDir);
      invalidatedFilePaths.add(filePath);
    }
  }

  for (const [filePath, projectDir] of next) {
    if (!previous.has(filePath)) {
      changedProjectDirs.add(projectDir);
      invalidatedFilePaths.add(filePath);
    }
  }

  return {
    projectDirs: [...changedProjectDirs].sort(),
    invalidatedFilePaths: [...invalidatedFilePaths],
  };
}
