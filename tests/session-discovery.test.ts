import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findBestClaudeSession } from "../electron/session-discovery.ts";

function withClaudeHome(
  setup: (homeDir: string, sessionsDir: string) => void,
  verify: (homeDir: string) => void,
) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-claude-home-"));
  const sessionsDir = path.join(homeDir, ".claude", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  try {
    setup(homeDir, sessionsDir);
    verify(homeDir);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

test("findBestClaudeSession prefers exact pid sidecar", () => {
  withClaudeHome(
    (_homeDir, sessionsDir) => {
      fs.writeFileSync(
        path.join(sessionsDir, "4321.json"),
        JSON.stringify({
          pid: 4321,
          cwd: "/tmp/project",
          startedAt: 1774527009598,
          sessionId: "session-exact",
        }),
        "utf-8",
      );
    },
    (homeDir) => {
      const match = findBestClaudeSession(
        "/tmp/project",
        "2026-03-26T00:10:09.598Z",
        4321,
        homeDir,
      );
      assert.deepEqual(match, {
        sessionId: "session-exact",
        filePath: path.join(homeDir, ".claude", "sessions", "4321.json"),
        confidence: "strong",
      });
    },
  );
});

test("findBestClaudeSession falls back to cwd and start time when pid sidecar is missing", () => {
  const olderStartedAt = 1774527000000;
  const nearestStartedAt = 1774527009598;
  withClaudeHome(
    (_homeDir, sessionsDir) => {
      fs.writeFileSync(
        path.join(sessionsDir, "1111.json"),
        JSON.stringify({
          pid: 1111,
          cwd: "/tmp/project",
          startedAt: olderStartedAt,
          sessionId: "session-older",
        }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(sessionsDir, "2222.json"),
        JSON.stringify({
          pid: 2222,
          cwd: "/tmp/project",
          startedAt: nearestStartedAt,
          sessionId: "session-nearest",
        }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(sessionsDir, "3333.json"),
        JSON.stringify({
          pid: 3333,
          cwd: "/tmp/other",
          startedAt: 1774527009598,
          sessionId: "session-other",
        }),
        "utf-8",
      );
    },
    (homeDir) => {
      const match = findBestClaudeSession(
        "/tmp/project",
        new Date(nearestStartedAt).toISOString(),
        9999,
        homeDir,
      );
      assert.deepEqual(match, {
        sessionId: "session-nearest",
        filePath: path.join(homeDir, ".claude", "sessions", "2222.json"),
        confidence: "medium",
      });
    },
  );
});
