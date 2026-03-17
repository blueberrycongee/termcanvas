import fs from "fs";
import path from "path";
import {
  getComposerAdapter,
  type ComposerImageFallbackMode,
} from "../src/terminal/cliConfig";
import type {
  ComposerImageAttachment,
  ComposerSubmitRequest,
  ComposerSubmitResult,
} from "../src/types";

export interface ClipboardSnapshot {
  text: string;
  imageDataUrl: string | null;
}

export interface ComposerSubmitDeps {
  platform: "darwin" | "win32" | "linux";
  mkdirSync: (dirPath: string) => void;
  writeFileSync: (filePath: string, buffer: Buffer) => void;
  dataUrlToPngBuffer: (dataUrl: string) => Buffer;
  snapshotClipboard: () => ClipboardSnapshot;
  restoreClipboard: (snapshot: ClipboardSnapshot) => void;
  writeClipboardText: (text: string) => void;
  writeClipboardImage: (dataUrl: string) => void;
  writeToPty: (ptyId: number, data: string) => void;
  generateRequestId: () => string;
  delayMs: (ms: number) => Promise<void>;
}

export function createDefaultComposerSubmitDeps(
  platform: "darwin" | "win32" | "linux",
  clipboard: {
    snapshot: () => ClipboardSnapshot;
    restore: (snapshot: ClipboardSnapshot) => void;
    writeText: (text: string) => void;
    writeImage: (dataUrl: string) => void;
    dataUrlToPngBuffer: (dataUrl: string) => Buffer;
  },
  writeToPty: (ptyId: number, data: string) => void,
): ComposerSubmitDeps {
  return {
    platform,
    mkdirSync: (dirPath) => fs.mkdirSync(dirPath, { recursive: true }),
    writeFileSync: (filePath, buffer) => fs.writeFileSync(filePath, buffer),
    dataUrlToPngBuffer: clipboard.dataUrlToPngBuffer,
    snapshotClipboard: clipboard.snapshot,
    restoreClipboard: clipboard.restore,
    writeClipboardText: clipboard.writeText,
    writeClipboardImage: clipboard.writeImage,
    writeToPty,
    generateRequestId: () =>
      `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    delayMs: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function getComposerRequestDir(
  worktreePath: string,
  requestId: string,
): string {
  return path.join(worktreePath, ".termcanvas", "composer", requestId);
}

export function buildComposerImagePath(
  worktreePath: string,
  requestId: string,
  index: number,
): string {
  return path.join(
    getComposerRequestDir(worktreePath, requestId),
    `image-${index + 1}.png`,
  );
}

export function stageComposerImages(
  worktreePath: string,
  requestId: string,
  images: ComposerImageAttachment[],
  deps: Pick<ComposerSubmitDeps, "mkdirSync" | "writeFileSync" | "dataUrlToPngBuffer">,
): string[] {
  if (images.length === 0) {
    return [];
  }

  const requestDir = getComposerRequestDir(worktreePath, requestId);
  deps.mkdirSync(requestDir);

  return images.map((image, index) => {
    const filePath = buildComposerImagePath(worktreePath, requestId, index);
    deps.writeFileSync(filePath, deps.dataUrlToPngBuffer(image.dataUrl));
    return filePath;
  });
}

async function submitImages(
  request: ComposerSubmitRequest,
  stagedImagePaths: string[],
  deps: ComposerSubmitDeps,
  imageFallback: ComposerImageFallbackMode,
  pasteSequence: string,
  pasteDelayMs: number,
) {
  for (let index = 0; index < request.images.length; index++) {
    const image = request.images[index];
    const stagedPath = stagedImagePaths[index];

    try {
      deps.writeClipboardImage(image.dataUrl);
    } catch (error) {
      if (imageFallback !== "image-path") {
        throw new Error(
          `Image paste is unavailable for ${request.terminalType}: ${String(error)}`,
        );
      }
      deps.writeClipboardText(stagedPath);
    }

    deps.writeToPty(request.ptyId, pasteSequence);
    await deps.delayMs(pasteDelayMs);
  }
}

export async function submitComposerRequest(
  request: ComposerSubmitRequest,
  deps: ComposerSubmitDeps,
): Promise<ComposerSubmitResult> {
  const adapter = getComposerAdapter(request.terminalType);
  if (!adapter) {
    return { ok: false, error: `Composer is not supported for ${request.terminalType}.` };
  }

  if (request.text.trim().length === 0 && request.images.length === 0) {
    return { ok: false, error: "Composer submission requires text or images." };
  }

  const requestId = deps.generateRequestId();
  const stagedImagePaths = stageComposerImages(
    request.worktreePath,
    requestId,
    request.images,
    deps,
  );
  const snapshot = deps.snapshotClipboard();
  const pasteSequence = adapter.pasteKeySequence(deps.platform);

  try {
    await submitImages(
      request,
      stagedImagePaths,
      deps,
      adapter.imageFallback,
      pasteSequence,
      adapter.pasteDelayMs,
    );

    if (request.text.trim().length > 0) {
      deps.writeClipboardText(request.text);
      deps.writeToPty(request.ptyId, pasteSequence);
      await deps.delayMs(adapter.pasteDelayMs);
    }

    deps.writeToPty(request.ptyId, "\r");

    return {
      ok: true,
      requestId,
      stagedImagePaths,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      requestId,
      stagedImagePaths,
    };
  } finally {
    deps.restoreClipboard(snapshot);
  }
}
