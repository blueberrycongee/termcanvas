import type { SessionInfo } from "../shared/sessions.ts";

function shouldReplaceSession(current: SessionInfo, candidate: SessionInfo): boolean {
  if (candidate.isManaged !== current.isManaged) {
    return candidate.isManaged;
  }

  if (candidate.lastActivityAt !== current.lastActivityAt) {
    return candidate.lastActivityAt > current.lastActivityAt;
  }

  if (candidate.isLive !== current.isLive) {
    return candidate.isLive;
  }

  return false;
}

export function mergeAndDedupeSessions(
  managedSessions: SessionInfo[],
  externalSessions: SessionInfo[],
): SessionInfo[] {
  const bySessionId = new Map<string, SessionInfo>();

  for (const session of [...managedSessions, ...externalSessions]) {
    const existing = bySessionId.get(session.sessionId);
    if (!existing || shouldReplaceSession(existing, session)) {
      bySessionId.set(session.sessionId, session);
    }
  }

  return [...bySessionId.values()].sort(
    (a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
}
