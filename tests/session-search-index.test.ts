import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  clearSessionIndexCache,
  listSessionsForProjects,
  listSessionsForProjectsPaged,
} from "../electron/session-search-index.ts";

async function withTempHome(
  fn: (homeDir: string) => Promise<void> | void,
): Promise<void> {
  const homeDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "termcanvas-session-search-index-"),
  );
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  try {
    clearSessionIndexCache();
    await fn(homeDir);
  } finally {
    clearSessionIndexCache();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function writeJsonl(filePath: string, lines: object[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    lines.map((line) => JSON.stringify(line)).join("\n"),
    "utf-8",
  );
}

test("listSessionsForProjects matches codex cwd against canvas paths despite slash style differences on Windows", async () => {
  await withTempHome(async (homeDir) => {
    const sessionFile = path.join(
      homeDir,
      ".codex",
      "sessions",
      "2026",
      "05",
      "01",
      "rollout-2026-05-01T21-02-49-session-1.jsonl",
    );
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-05-01T13:02:49.179Z",
        type: "session_meta",
        payload: {
          id: "session-1",
          cwd: "E:\\GitHub\\open-source\\termcanvas",
          timestamp: "2026-05-01T13:02:49.179Z",
        },
      },
      {
        timestamp: "2026-05-01T13:02:50.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "调查历史面板为什么缺会话",
        },
      },
    ]);

    const entries = await listSessionsForProjects([
      "E:/GitHub/open-source/termcanvas",
    ]);

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.sessionId, "session-1");
    assert.equal(
      entries[0]?.projectDir,
      "E:\\GitHub\\open-source\\termcanvas",
    );
  });
});

test("listSessionsForProjectsPaged applies the same normalized matching for codex and kimi sessions", async () => {
  await withTempHome(async (homeDir) => {
    const codexFile = path.join(
      homeDir,
      ".codex",
      "sessions",
      "2026",
      "05",
      "01",
      "rollout-2026-05-01T21-02-49-session-codex.jsonl",
    );
    writeJsonl(codexFile, [
      {
        timestamp: "2026-05-01T13:02:49.179Z",
        type: "session_meta",
        payload: {
          id: "session-codex",
          cwd: "E:\\GitHub\\others\\test-repo",
          timestamp: "2026-05-01T13:02:49.179Z",
        },
      },
      {
        timestamp: "2026-05-01T13:02:50.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "修一下历史面板",
        },
      },
    ]);

    const { entries } = await listSessionsForProjectsPaged(
      ["E:/GitHub/others/test-repo"],
      { limit: 10, offset: 0 },
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.sessionId, "session-codex");
  });
});
