import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";

import {
  findBestClaudeSession,
  findBestCodexSession,
  findBestWuuSession,
  readLatestCodexSessionId,
} from "../electron/session-discovery.ts";

function withTempHome(fn: (homeDir: string) => void): void {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-session-discovery-"));
  try {
    fn(homeDir);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function withClaudeHome(
  setup: (homeDir: string, sessionsDir: string) => void,
  verify: (homeDir: string) => void,
): void {
  withTempHome((homeDir) => {
    const sessionsDir = path.join(homeDir, ".claude", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    setup(homeDir, sessionsDir);
    verify(homeDir);
  });
}

function writeJsonl(filePath: string, lines: object[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    lines.map((line) => JSON.stringify(line)).join("\n"),
    "utf-8",
  );
}

function writeCodexSession(
  homeDir: string,
  sessionId: string,
  timestamp: string,
  cwd: string,
): string {
  const date = new Date(timestamp);
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const filePath = path.join(
    homeDir,
    ".codex",
    "sessions",
    yyyy,
    mm,
    dd,
    `rollout-${yyyy}-${mm}-${dd}T${hh}-${mi}-${ss}-${sessionId}.jsonl`,
  );
  writeJsonl(filePath, [
    {
      timestamp,
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp,
        cwd,
      },
    },
    {
      timestamp,
      type: "event_msg",
      payload: { type: "task_complete" },
    },
  ]);
  return filePath;
}

function writeSessionIndex(homeDir: string, entries: Array<{ id: string; updated_at: string }>): void {
  const indexPath = path.join(homeDir, ".codex", "session_index.jsonl");
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(
    indexPath,
    entries.map((entry) => JSON.stringify(entry)).join("\n"),
    "utf-8",
  );
}

function writeStateDbThreads(
  homeDir: string,
  rows: Array<{
    id: string;
    cwd: string;
    createdAtSec: number;
    updatedAtSec: number;
    rolloutPath: string;
    archived?: number;
  }>,
): void {
  const dbPath = path.join(homeDir, ".codex", "state_5.sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        cwd TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      )
    `);

    const stmt = db.prepare(`
      INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, archived)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const row of rows) {
      stmt.run(
        row.id,
        row.rolloutPath,
        row.createdAtSec,
        row.updatedAtSec,
        row.cwd,
        row.archived ?? 0,
      );
    }
  } finally {
    db.close();
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

test("readLatestCodexSessionId reads the newest session index entry", () => {
  withTempHome((homeDir) => {
    writeSessionIndex(homeDir, [
      { id: "older-session", updated_at: "2026-04-05T09:00:00Z" },
      { id: "newest-session", updated_at: "2026-04-05T09:05:00Z" },
    ]);

    assert.equal(readLatestCodexSessionId(homeDir), "newest-session");
  });
});

test("readLatestCodexSessionId prefers the newest state db thread id", () => {
  withTempHome((homeDir) => {
    writeStateDbThreads(homeDir, [
      {
        id: "db-older-session",
        cwd: "/tmp/project",
        createdAtSec: 100,
        updatedAtSec: 100,
        rolloutPath: "/tmp/older.jsonl",
      },
      {
        id: "db-newest-session",
        cwd: "/tmp/project",
        createdAtSec: 200,
        updatedAtSec: 200,
        rolloutPath: "/tmp/newest.jsonl",
      },
    ]);
    writeSessionIndex(homeDir, [
      { id: "index-session", updated_at: "2026-04-05T09:05:00Z" },
    ]);

    assert.equal(readLatestCodexSessionId(homeDir), "db-newest-session");
  });
});

test("findBestCodexSession prefers state db matches before file fallback", () => {
  withTempHome((homeDir) => {
    const startedAt = "2026-04-05T05:47:17.000Z";
    const targetFile = writeCodexSession(
      homeDir,
      "file-session",
      "2026-04-05T05:47:18.000Z",
      "/tmp/project-db",
    );

    writeStateDbThreads(homeDir, [
      {
        id: "db-target-session",
        cwd: "/tmp/project-db",
        createdAtSec: 1775339237,
        updatedAtSec: 1775339238,
        rolloutPath: "/tmp/from-db.jsonl",
      },
      {
        id: "db-other-session",
        cwd: "/tmp/other",
        createdAtSec: 1775339200,
        updatedAtSec: 1775339201,
        rolloutPath: "/tmp/other.jsonl",
      },
    ]);

    const found = findBestCodexSession("/tmp/project-db", startedAt, homeDir);

    assert.deepEqual(found, {
      sessionId: "db-target-session",
      filePath: "/tmp/from-db.jsonl",
      confidence: "medium",
    });
    assert.notEqual(found?.filePath, targetFile);
  });
});

test("findBestCodexSession prefers recent indexed sessions that match cwd", () => {
  withTempHome((homeDir) => {
    const now = new Date();
    const targetAt = new Date(now.getTime() - 60_000).toISOString();
    const otherAt = new Date(now.getTime() - 120_000).toISOString();
    const staleAt = new Date(now.getTime() - 180_000).toISOString();

    const targetCwd = "/tmp/project-a";
    writeCodexSession(homeDir, "stale-session", staleAt, targetCwd);
    const targetFile = writeCodexSession(homeDir, "target-session", targetAt, targetCwd);
    writeCodexSession(homeDir, "other-session", otherAt, "/tmp/project-b");

    writeSessionIndex(homeDir, [
      { id: "stale-session", updated_at: staleAt },
      { id: "other-session", updated_at: otherAt },
      { id: "target-session", updated_at: targetAt },
    ]);

    const found = findBestCodexSession(
      targetCwd,
      new Date(now.getTime() - 55_000).toISOString(),
      homeDir,
    );

    assert.deepEqual(found, {
      sessionId: "target-session",
      filePath: targetFile,
      confidence: "medium",
    });
  });
});

test("findBestCodexSession falls back to a bounded recent file scan when index is unavailable", () => {
  withTempHome((homeDir) => {
    const now = new Date();
    const targetAt = new Date(now.getTime() - 30_000).toISOString();
    const otherAt = new Date(now.getTime() - 45_000).toISOString();

    const targetFile = writeCodexSession(homeDir, "scanned-session", targetAt, "/tmp/project-c");
    writeCodexSession(homeDir, "other-session", otherAt, "/tmp/project-d");

    const found = findBestCodexSession(
      "/tmp/project-c",
      new Date(now.getTime() - 25_000).toISOString(),
      homeDir,
    );

    assert.deepEqual(found, {
      sessionId: "scanned-session",
      filePath: targetFile,
      confidence: "medium",
    });
  });
});

test("findBestCodexSession keeps a weak latest-id fallback when no cwd match is available", () => {
  withTempHome((homeDir) => {
    const now = new Date().toISOString();

    const latestFile = writeCodexSession(homeDir, "latest-session", now, "/tmp/unrelated-project");
    writeSessionIndex(homeDir, [
      { id: "latest-session", updated_at: now },
    ]);

    const found = findBestCodexSession("/tmp/missing-project", now, homeDir);

    assert.deepEqual(found, {
      sessionId: "latest-session",
      filePath: latestFile,
      confidence: "weak",
    });
  });
});

test("findBestWuuSession ignores sessions created before the terminal started", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-wuu-session-"));
  try {
    const sessionsDir = path.join(workspaceDir, ".wuu", "sessions");
    const staleSessionId = "20260411-100000-abcd";
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, "index.jsonl"),
      `${JSON.stringify({
        id: staleSessionId,
        created_at: "2026-04-11T10:00:00.000Z",
      })}\n`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(sessionsDir, `${staleSessionId}.jsonl`),
      JSON.stringify({ role: "user", content: "old" }),
      "utf-8",
    );

    const found = findBestWuuSession(
      workspaceDir,
      "2026-04-11T10:05:00.000Z",
    );

    assert.equal(found, null);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("findBestWuuSession picks the newest indexed session created after launch", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-wuu-session-"));
  try {
    const sessionsDir = path.join(workspaceDir, ".wuu", "sessions");
    const olderSessionId = "20260411-100000-abcd";
    const freshSessionId = "20260411-100502-beef";
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, "index.jsonl"),
      [
        JSON.stringify({
          id: olderSessionId,
          created_at: "2026-04-11T10:00:00.000Z",
        }),
        JSON.stringify({
          id: freshSessionId,
          created_at: "2026-04-11T10:05:02.000Z",
        }),
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(sessionsDir, `${olderSessionId}.jsonl`),
      JSON.stringify({ role: "user", content: "older" }),
      "utf-8",
    );
    const freshFile = path.join(sessionsDir, `${freshSessionId}.jsonl`);
    fs.writeFileSync(
      freshFile,
      JSON.stringify({ role: "user", content: "fresh" }),
      "utf-8",
    );

    const found = findBestWuuSession(
      workspaceDir,
      "2026-04-11T10:05:00.000Z",
    );

    assert.deepEqual(found, {
      sessionId: freshSessionId,
      filePath: freshFile,
      confidence: "medium",
    });
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});
