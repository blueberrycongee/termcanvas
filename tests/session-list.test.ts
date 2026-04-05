import test from "node:test";
import assert from "node:assert/strict";

import { mergeAndDedupeSessions } from "../electron/session-list.ts";
import type { SessionInfo } from "../shared/sessions.ts";

function createSession(
  overrides: Partial<SessionInfo> & Pick<SessionInfo, "sessionId">,
): SessionInfo {
  return {
    sessionId: overrides.sessionId,
    projectDir: overrides.projectDir ?? "/tmp/project",
    filePath: overrides.filePath ?? `/tmp/${overrides.sessionId}.jsonl`,
    isLive: overrides.isLive ?? true,
    isManaged: overrides.isManaged ?? false,
    status: overrides.status ?? "idle",
    currentTool: overrides.currentTool,
    startedAt: overrides.startedAt ?? "2026-04-05T10:00:00.000Z",
    lastActivityAt: overrides.lastActivityAt ?? "2026-04-05T10:05:00.000Z",
    messageCount: overrides.messageCount ?? 1,
    tokenTotal: overrides.tokenTotal ?? 0,
  };
}

test("mergeAndDedupeSessions keeps managed session over external duplicate", () => {
  const managed = [
    createSession({
      sessionId: "session-1",
      isManaged: true,
      status: "tool_running",
      lastActivityAt: "2026-04-05T10:05:00.000Z",
    }),
  ];
  const external = [
    createSession({
      sessionId: "session-1",
      isManaged: false,
      status: "turn_complete",
      isLive: false,
      lastActivityAt: "2026-04-05T10:06:00.000Z",
    }),
  ];

  const merged = mergeAndDedupeSessions(managed, external);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].isManaged, true);
  assert.equal(merged[0].status, "tool_running");
});

test("mergeAndDedupeSessions collapses duplicate managed sessions by latest activity", () => {
  const managed = [
    createSession({
      sessionId: "session-1",
      isManaged: true,
      status: "idle",
      lastActivityAt: "2026-04-05T10:05:00.000Z",
    }),
    createSession({
      sessionId: "session-1",
      isManaged: true,
      status: "generating",
      lastActivityAt: "2026-04-05T10:07:00.000Z",
    }),
  ];

  const merged = mergeAndDedupeSessions(managed, []);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "generating");
  assert.equal(merged[0].lastActivityAt, "2026-04-05T10:07:00.000Z");
});

test("mergeAndDedupeSessions sorts unique sessions by latest activity", () => {
  const managed = [
    createSession({
      sessionId: "session-2",
      isManaged: true,
      lastActivityAt: "2026-04-05T10:04:00.000Z",
    }),
  ];
  const external = [
    createSession({
      sessionId: "session-1",
      isManaged: false,
      lastActivityAt: "2026-04-05T10:06:00.000Z",
    }),
  ];

  const merged = mergeAndDedupeSessions(managed, external);

  assert.deepEqual(
    merged.map((session) => session.sessionId),
    ["session-1", "session-2"],
  );
});
