import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionHistoryScope,
  diffSessionHistoryScopes,
} from "../electron/session-history-events.ts";
import type { SessionInfo } from "../shared/sessions.ts";

function createSession(
  overrides: Partial<SessionInfo> & Pick<SessionInfo, "sessionId">,
): SessionInfo {
  return {
    sessionId: overrides.sessionId,
    projectDir: overrides.projectDir ?? "/tmp/project",
    filePath: overrides.filePath ?? `/tmp/${overrides.sessionId}.jsonl`,
    isLive: overrides.isLive ?? false,
    isManaged: overrides.isManaged ?? false,
    status: overrides.status ?? "idle",
    currentTool: overrides.currentTool,
    startedAt: overrides.startedAt ?? "2026-04-05T10:00:00.000Z",
    lastActivityAt: overrides.lastActivityAt ?? "2026-04-05T10:05:00.000Z",
    messageCount: overrides.messageCount ?? 1,
    tokenTotal: overrides.tokenTotal ?? 0,
  };
}

test("buildSessionHistoryScope skips sessions without scope data", () => {
  const scope = buildSessionHistoryScope([
    createSession({ sessionId: "kept" }),
    createSession({
      sessionId: "missing-file",
      filePath: "",
    }),
    createSession({
      sessionId: "missing-project",
      projectDir: "",
    }),
  ]);

  assert.deepEqual([...scope.entries()], [["/tmp/kept.jsonl", "/tmp/project"]]);
});

test("diffSessionHistoryScopes reports added and removed project dirs", () => {
  const previous = buildSessionHistoryScope([
    createSession({
      sessionId: "removed",
      filePath: "/tmp/removed.jsonl",
      projectDir: "/tmp/old-project",
    }),
  ]);
  const next = buildSessionHistoryScope([
    createSession({
      sessionId: "added",
      filePath: "/tmp/added.jsonl",
      projectDir: "/tmp/new-project",
    }),
  ]);

  const diff = diffSessionHistoryScopes(previous, next);

  assert.deepEqual(diff.projectDirs, ["/tmp/new-project", "/tmp/old-project"]);
  assert.deepEqual(
    diff.invalidatedFilePaths.sort(),
    ["/tmp/added.jsonl", "/tmp/removed.jsonl"],
  );
});

test("diffSessionHistoryScopes invalidates files whose project scope changes", () => {
  const previous = new Map([["/tmp/shared.jsonl", "/tmp/project-a"]]);
  const next = new Map([["/tmp/shared.jsonl", "/tmp/project-b"]]);

  const diff = diffSessionHistoryScopes(previous, next);

  assert.deepEqual(diff.projectDirs, ["/tmp/project-a", "/tmp/project-b"]);
  assert.deepEqual(diff.invalidatedFilePaths, ["/tmp/shared.jsonl"]);
});
