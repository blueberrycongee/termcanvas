import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  buildComposerImagePath,
  stageComposerImages,
  submitComposerRequest,
  type ClipboardSnapshot,
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
  clipboardTextWrites: string[];
  clipboardImageWrites: string[];
  restoredSnapshots: ClipboardSnapshot[];
  fileWrites: { filePath: string; content: string }[];
} {
  const ptyWrites: string[] = [];
  const clipboardTextWrites: string[] = [];
  const clipboardImageWrites: string[] = [];
  const restoredSnapshots: ClipboardSnapshot[] = [];
  const fileWrites: { filePath: string; content: string }[] = [];

  return {
    deps: {
      platform: "win32",
      mkdirSync: () => {},
      writeFileSync: (filePath, buffer) => {
        fileWrites.push({ filePath, content: buffer.toString("utf-8") });
      },
      dataUrlToPngBuffer: () => Buffer.from("png-data"),
      snapshotClipboard: () => ({
        text: "before",
        imageDataUrl: "data:image/png;base64,b2xk",
      }),
      restoreClipboard: (snapshot) => {
        restoredSnapshots.push(snapshot);
      },
      writeClipboardText: (text) => {
        clipboardTextWrites.push(text);
      },
      writeClipboardImage: (dataUrl) => {
        clipboardImageWrites.push(dataUrl);
      },
      writeToPty: (_ptyId, data) => {
        ptyWrites.push(data);
      },
      generateRequestId: () => "req-123",
      delayMs: async () => {},
      ...overrides,
    },
    ptyWrites,
    clipboardTextWrites,
    clipboardImageWrites,
    restoredSnapshots,
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

test("codex returns an error when clipboard image write fails", async () => {
  const request = createRequest({ terminalType: "codex" });
  const { deps, restoredSnapshots, ptyWrites } = createDeps({
    writeClipboardImage: () => {
      throw new Error("clipboard unavailable");
    },
  });

  const result = await submitComposerRequest(request, deps);

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /clipboard unavailable/);
  assert.deepEqual(ptyWrites, []);
  assert.equal(restoredSnapshots.length, 1);
});

test("claude falls back to staged image paths when clipboard image write fails", async () => {
  const request = createRequest();
  const {
    deps,
    clipboardTextWrites,
    ptyWrites,
    restoredSnapshots,
  } = createDeps({
    writeClipboardImage: () => {
      throw new Error("clipboard unavailable");
    },
  });

  const result = await submitComposerRequest(request, deps);

  assert.equal(result.ok, true);
  assert.equal(clipboardTextWrites[0].endsWith(path.join("req-123", "image-1.png")), true);
  assert.equal(clipboardTextWrites[1], "Inspect this screenshot");
  assert.deepEqual(ptyWrites, ["\u0016", "\u0016", "\r"]);
  assert.equal(restoredSnapshots.length, 1);
});
