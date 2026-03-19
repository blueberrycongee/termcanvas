import fs from "fs";
import path from "path";
import {
  getComposerAdapter,
  type ComposerAdapterConfig,
} from "../src/terminal/cliConfig.ts";
import type {
  ComposerImageAttachment,
  ComposerSubmitIssueCode,
  ComposerSubmitIssueStage,
  ComposerSubmitRequest,
  ComposerSubmitResult,
} from "../src/types";

export interface ComposerSubmitDeps {
  platform: "darwin" | "win32" | "linux";
  mkdirSync: (dirPath: string) => void;
  writeFileSync: (filePath: string, buffer: Buffer) => void;
  dataUrlToPngBuffer: (dataUrl: string) => Buffer;
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
  dataUrlToPngBuffer: (dataUrl: string) => Buffer,
  writeToPty: (ptyId: number, data: string) => void,
): ComposerSubmitDeps {
  return {
    platform,
    mkdirSync: (dirPath) => fs.mkdirSync(dirPath, { recursive: true }),
    writeFileSync: (filePath, buffer) => fs.writeFileSync(filePath, buffer),
    dataUrlToPngBuffer,
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

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

function buildBracketedPaste(text: string): string {
  return BRACKETED_PASTE_START + text + BRACKETED_PASTE_END;
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

  // Build an ordered list of paste payloads. The \r is appended to the final
  // write() to eliminate the inter-write scheduling gap that caused the old
  // race condition. CLI parsers (Ink, Crossterm, etc.) are stream-aware and
  // preserve event boundaries across read() chunks, so correctness does not
  // depend on a single read() — but removing the gap avoids the window where
  // the TUI could re-render between the paste-end marker and the submit key.
  const pastes: { data: string; stage: ComposerSubmitIssueStage }[] = [];
  for (const imagePath of stagedImagePaths) {
    pastes.push({ data: imagePath, stage: "paste-image" });
  }
  if (request.text.trim().length > 0) {
    pastes.push({ data: request.text, stage: "paste-text" });
  }

  try {
    for (let i = 0; i < pastes.length; i++) {
      const { data, stage } = pastes[i];
      const isLast = i === pastes.length - 1;
      const payload = isLast
        ? buildBracketedPaste(data) + "\r"
        : buildBracketedPaste(data);

      writePtyData(request.ptyId, payload, deps, stage, isLast ? "submit-key-failed" : "pty-write-failed");

      if (!isLast) {
        await deps.delayMs(adapter.pasteDelayMs);
      }
    }

    // Edge case: no pastes at all (validated away earlier, but be defensive)
    if (pastes.length === 0) {
      writePtyData(request.ptyId, "\r", deps, "submit", "submit-key-failed");
    }

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

/**
 * Remove staged image directories from previous composer submissions.
 * Called at the start of every new submit so temp files don't accumulate.
 */
function cleanupOldComposerRequests(worktreePath: string): void {
  const composerDir = path.join(worktreePath, ".termcanvas", "composer");
  let entries: string[];
  try {
    entries = fs.readdirSync(composerDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    try {
      fs.rmSync(path.join(composerDir, entry), { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

export async function submitComposerRequest(
  request: ComposerSubmitRequest,
  deps: ComposerSubmitDeps,
): Promise<ComposerSubmitResult> {
  cleanupOldComposerRequests(request.worktreePath);

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

  return submitBracketedPaste(request, deps, adapter);
}
