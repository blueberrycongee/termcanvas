import fs from "fs";
import path from "path";
import {
  getComposerAdapter,
  type ComposerAdapterConfig,
  type ComposerImageFallbackMode,
} from "../src/terminal/cliConfig.ts";
import type {
  ComposerImageAttachment,
  ComposerSubmitIssueCode,
  ComposerSubmitIssueStage,
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

interface ComposerSubmitIssue {
  code: ComposerSubmitIssueCode;
  stage: ComposerSubmitIssueStage;
  detail: string;
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

function getErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createFailure(
  issue: ComposerSubmitIssue,
  extra: Pick<ComposerSubmitResult, "requestId" | "stagedImagePaths"> = {},
): ComposerSubmitResult {
  return {
    ok: false,
    error: issue.detail,
    detail: issue.detail,
    code: issue.code,
    stage: issue.stage,
    ...extra,
  };
}

function createWarning(issue: ComposerSubmitIssue): Pick<
  ComposerSubmitResult,
  "warning" | "warningDetail" | "warningCode" | "warningStage"
> {
  return {
    warning: issue.detail,
    warningDetail: issue.detail,
    warningCode: issue.code,
    warningStage: issue.stage,
  };
}

function writePtyData(
  ptyId: number,
  data: string,
  deps: ComposerSubmitDeps,
  stage: ComposerSubmitIssueStage,
  code: ComposerSubmitIssueCode,
) {
  try {
    deps.writeToPty(ptyId, data);
  } catch (error) {
    throw {
      code,
      stage,
      detail: getErrorDetail(error),
    } satisfies ComposerSubmitIssue;
  }
}

function snapshotClipboardSafely(
  deps: ComposerSubmitDeps,
): ClipboardSnapshot | ComposerSubmitIssue {
  try {
    return deps.snapshotClipboard();
  } catch (error) {
    return {
      code: "clipboard-capture-failed",
      stage: "capture-clipboard",
      detail: getErrorDetail(error),
    };
  }
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
        throw {
          code: "clipboard-image-failed",
          stage: "paste-image",
          detail: getErrorDetail(error),
        } satisfies ComposerSubmitIssue;
      }

      try {
        deps.writeClipboardText(stagedPath);
      } catch (fallbackError) {
        throw {
          code: "clipboard-text-failed",
          stage: "paste-image",
          detail: getErrorDetail(fallbackError),
        } satisfies ComposerSubmitIssue;
      }
    }

    writePtyData(
      request.ptyId,
      pasteSequence,
      deps,
      "paste-image",
      "pty-write-failed",
    );
    await deps.delayMs(pasteDelayMs);
  }
}

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

function writeBracketedPaste(
  ptyId: number,
  text: string,
  deps: ComposerSubmitDeps,
  stage: ComposerSubmitIssueStage,
): void {
  writePtyData(
    ptyId,
    BRACKETED_PASTE_START + text + BRACKETED_PASTE_END,
    deps,
    stage,
    "pty-write-failed",
  );
}

async function submitBracketedPaste(
  request: ComposerSubmitRequest,
  deps: ComposerSubmitDeps,
  adapter: ComposerAdapterConfig,
): Promise<ComposerSubmitResult> {
  if (request.images.length > 0 && !adapter.supportsImages) {
    return createFailure({
      code: "images-unsupported",
      stage: "validate",
      detail: `Image paste is unavailable for ${request.terminalType}.`,
    });
  }

  const requestId = deps.generateRequestId();
  let stagedImagePaths: string[] = [];

  if (request.images.length > 0) {
    try {
      stagedImagePaths = stageComposerImages(
        request.worktreePath,
        requestId,
        request.images,
        deps,
      );
    } catch (error) {
      return createFailure(
        {
          code: "image-stage-failed",
          stage: "prepare-images",
          detail: getErrorDetail(error),
        },
        { requestId },
      );
    }
  }

  try {
    for (const imagePath of stagedImagePaths) {
      writeBracketedPaste(request.ptyId, imagePath, deps, "paste-image");
      await deps.delayMs(adapter.pasteDelayMs);
    }

    if (request.text.trim().length > 0) {
      writeBracketedPaste(request.ptyId, request.text, deps, "paste-text");
    }

    writePtyData(request.ptyId, "\r", deps, "submit", "submit-key-failed");

    return { ok: true, requestId, stagedImagePaths };
  } catch (error) {
    const issue =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "stage" in error &&
      "detail" in error
        ? (error as ComposerSubmitIssue)
        : ({
            code: "internal-error" as const,
            stage: "submit" as const,
            detail: getErrorDetail(error),
          } satisfies ComposerSubmitIssue);

    return createFailure(issue, { requestId, stagedImagePaths });
  }
}

async function submitDirectText(
  request: ComposerSubmitRequest,
  deps: ComposerSubmitDeps,
) {
  if (request.images.length > 0) {
    return createFailure({
      code: "images-unsupported",
      stage: "validate",
      detail: `Image paste is unavailable for ${request.terminalType}.`,
    });
  }

  try {
    if (request.text.length > 0) {
      writePtyData(
        request.ptyId,
        request.text,
        deps,
        "paste-text",
        "pty-write-failed",
      );
    }
    writePtyData(request.ptyId, "\r", deps, "submit", "submit-key-failed");
  } catch (error) {
    return createFailure(error as ComposerSubmitIssue);
  }

  return {
    ok: true,
    requestId: deps.generateRequestId(),
    stagedImagePaths: [],
  };
}

export async function submitComposerRequest(
  request: ComposerSubmitRequest,
  deps: ComposerSubmitDeps,
): Promise<ComposerSubmitResult> {
  const adapter = getComposerAdapter(request.terminalType);
  if (!adapter) {
    return createFailure({
      code: "unsupported-terminal",
      stage: "target",
      detail: `Composer is not supported for ${request.terminalType}.`,
    });
  }

  if (request.text.trim().length === 0 && request.images.length === 0) {
    return createFailure({
      code: "empty-submit",
      stage: "validate",
      detail: "Composer submission requires text or images.",
    });
  }

  if (adapter.inputMode === "type") {
    return submitDirectText(request, deps);
  }

  if (adapter.inputMode === "bracketed-paste") {
    return submitBracketedPaste(request, deps, adapter);
  }

  if (request.images.length > 0 && !adapter.supportsImages) {
    return createFailure({
      code: "images-unsupported",
      stage: "validate",
      detail: `Image paste is unavailable for ${request.terminalType}.`,
    });
  }

  const requestId = deps.generateRequestId();
  let stagedImagePaths: string[] = [];
  try {
    stagedImagePaths = stageComposerImages(
      request.worktreePath,
      requestId,
      request.images,
      deps,
    );
  } catch (error) {
    return createFailure(
      {
        code: "image-stage-failed",
        stage: "prepare-images",
        detail: getErrorDetail(error),
      },
      { requestId },
    );
  }

  const snapshotResult = snapshotClipboardSafely(deps);
  if ("code" in snapshotResult) {
    return createFailure(snapshotResult, { requestId, stagedImagePaths });
  }

  const snapshot = snapshotResult;
  const pasteSequence = adapter.pasteKeySequence(deps.platform);
  let submitResult: ComposerSubmitResult;

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
      try {
        deps.writeClipboardText(request.text);
      } catch (error) {
        return createFailure(
          {
            code: "clipboard-text-failed",
            stage: "paste-text",
            detail: getErrorDetail(error),
          },
          { requestId, stagedImagePaths },
        );
      }

      writePtyData(
        request.ptyId,
        pasteSequence,
        deps,
        "paste-text",
        "pty-write-failed",
      );
      await deps.delayMs(adapter.pasteDelayMs);
    }

    writePtyData(request.ptyId, "\r", deps, "submit", "submit-key-failed");

    submitResult = {
      ok: true,
      requestId,
      stagedImagePaths,
    };
  } catch (error) {
    const issue =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "stage" in error &&
      "detail" in error
        ? (error as ComposerSubmitIssue)
        : ({
            code: "internal-error",
            stage: "submit",
            detail: getErrorDetail(error),
          } satisfies ComposerSubmitIssue);

    submitResult = createFailure(issue, {
      requestId,
      stagedImagePaths,
    });
  } finally {
    try {
      deps.restoreClipboard(snapshot);
    } catch (error) {
      const warning = createWarning({
        code: "clipboard-restore-failed",
        stage: "restore-clipboard",
        detail: getErrorDetail(error),
      });
      submitResult = {
        ...submitResult,
        ...warning,
      };
    }
  }

  return submitResult;
}
