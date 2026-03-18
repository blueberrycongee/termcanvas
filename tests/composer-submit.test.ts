import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  buildComposerImagePath,
  stageComposerImages,
  submitComposerRequest,
  type ComposerSubmitDeps,
} from "../electron/composer-submit.ts";
import type { ComposerSubmitRequest } from "../src/types/index.ts";

function createRequest(
  overrides: Partial<ComposerSubmitRequest> = {},
): ComposerSubmitRequest {
  return {
    terminalId: "terminal-1",
    ptyId: 7,
    terminalType: "claude",
    worktreePath: "/repo/worktree",
    text: "Inspect this screenshot",
    images: [
      {
        id: "img-1",
        name: "pasted.png",
        dataUrl: "data:image/png;base64,ZmFrZQ==",
      },
    ],
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<ComposerSubmitDeps> = {},
): {
  deps: ComposerSubmitDeps;
  ptyWrites: string[];
  fileWrites: { filePath: string; content: string }[];
} {
  const ptyWrites: string[] = [];
  const fileWrites: { filePath: string; content: string }[] = [];

  return {
    deps: {
      platform: "win32",
      mkdirSync: () => {},
      writeFileSync: (filePath, buffer) => {
        fileWrites.push({ filePath, content: buffer.toString("utf-8") });
      },
      dataUrlToPngBuffer: () => Buffer.from("png-data"),
      writeToPty: (_ptyId, data) => {
        ptyWrites.push(data);
      },
      generateRequestId: () => "req-123",
      delayMs: async () => {},
      ...overrides,
    },
    ptyWrites,
    fileWrites,
  };
}

test("buildComposerImagePath writes staged pngs into the request directory", () => {
  assert.equal(
    buildComposerImagePath("/repo/worktree", "req-123", 1),
    path.join(
      "/repo/worktree",
      ".termcanvas",
      "composer",
      "req-123",
      "image-2.png",
    ),
  );
});

test("stageComposerImages writes png buffers for every pasted image", () => {
  const request = createRequest({
    images: [
      {
        id: "img-1",
        name: "one.png",
        dataUrl: "data:image/png;base64,Zm9v",
      },
      {
        id: "img-2",
        name: "two.png",
        dataUrl: "data:image/png;base64,YmFy",
      },
    ],
  });
  const { deps, fileWrites } = createDeps();

  const stagedPaths = stageComposerImages(
    request.worktreePath,
    "req-123",
    request.images,
    deps,
  );

  assert.equal(fileWrites.length, 2);
  assert.equal(stagedPaths[0].endsWith(path.join("req-123", "image-1.png")), true);
  assert.equal(stagedPaths[1].endsWith(path.join("req-123", "image-2.png")), true);
});

test("codex sends text via bracketed paste without clipboard", async () => {
  const request = createRequest({
    terminalType: "codex",
    text: "fix the bug",
    images: [],
  });
  const { deps, ptyWrites } = createDeps();

  const result = await submitComposerRequest(request, deps);

  assert.equal(result.ok, true);
  assert.deepEqual(ptyWrites, ["\x1b[200~fix the bug\x1b[201~", "\r"]);
});

test("codex sends image paths via bracketed paste without clipboard", async () => {
  const request = createRequest({
    terminalType: "codex",
    text: "check this",
    images: [
      {
        id: "img-1",
        name: "screenshot.png",
        dataUrl: "data:image/png;base64,ZmFrZQ==",
      },
    ],
  });
  const { deps, ptyWrites, fileWrites } = createDeps();

  const result = await submitComposerRequest(request, deps);

  assert.equal(result.ok, true);
  assert.equal(fileWrites.length, 1);
  assert.equal(
    fileWrites[0].filePath.endsWith(path.join("req-123", "image-1.png")),
    true,
  );
  assert.equal(ptyWrites.length, 3);
  assert.match(ptyWrites[0], /^\x1b\[200~.*image-1\.png\x1b\[201~$/);
  assert.equal(ptyWrites[1], "\x1b[200~check this\x1b[201~");
  assert.equal(ptyWrites[2], "\r");
});

test("claude sends text via bracketed paste without clipboard", async () => {
  const request = createRequest({
    terminalType: "claude",
    text: "fix the bug",
    images: [],
  });
  const { deps, ptyWrites } = createDeps();

  const result = await submitComposerRequest(request, deps);

  assert.equal(result.ok, true);
  assert.deepEqual(ptyWrites, ["\x1b[200~fix the bug\x1b[201~", "\r"]);
});

test("claude sends image paths via bracketed paste", async () => {
  const request = createRequest({
    terminalType: "claude",
    text: "Inspect this screenshot",
    images: [
      {
        id: "img-1",
        name: "pasted.png",
        dataUrl: "data:image/png;base64,ZmFrZQ==",
      },
    ],
  });
  const { deps, ptyWrites, fileWrites } = createDeps();

  const result = await submitComposerRequest(request, deps);

  assert.equal(result.ok, true);
  assert.equal(fileWrites.length, 1);
  assert.equal(
    fileWrites[0].filePath.endsWith(path.join("req-123", "image-1.png")),
    true,
  );
  assert.equal(ptyWrites.length, 3);
  assert.match(ptyWrites[0], /^\x1b\[200~.*image-1\.png\x1b\[201~$/);
  assert.equal(ptyWrites[1], "\x1b[200~Inspect this screenshot\x1b[201~");
  assert.equal(ptyWrites[2], "\r");
});

test("shell writes text directly to the PTY", async () => {
  const request = createRequest({
    terminalType: "shell",
    text: "git status",
    images: [],
  });
  const { deps, ptyWrites } = createDeps();

  const result = await submitComposerRequest(request, deps);

  assert.equal(result.ok, true);
  assert.deepEqual(ptyWrites, ["git status", "\r"]);
});

test("shell rejects image submission", async () => {
  const request = createRequest({
    terminalType: "shell",
    text: "",
  });
  const { deps, ptyWrites } = createDeps();

  const result = await submitComposerRequest(request, deps);

  assert.equal(result.ok, false);
  assert.equal(result.code, "images-unsupported");
  assert.equal(result.stage, "validate");
  assert.match(result.error ?? "", /Image paste is unavailable for shell/);
  assert.deepEqual(ptyWrites, []);
});

test("shell reports PTY write failures with stage details", async () => {
  const request = createRequest({
    terminalType: "shell",
    text: "git status",
    images: [],
  });
  const { deps } = createDeps({
    writeToPty: () => {
      throw new Error("pty closed");
    },
  });

  const result = await submitComposerRequest(request, deps);

  assert.equal(result.ok, false);
  assert.equal(result.code, "pty-write-failed");
  assert.equal(result.stage, "paste-text");
  assert.equal(result.detail, "pty closed");
});

