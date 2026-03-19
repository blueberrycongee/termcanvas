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
  /** Resolves when the PTY produces output, or after timeout. */
  waitForPtyOutput: (ptyId: number, timeoutMs: number) => Promise<void>;
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
  waitForPtyOutput: (ptyId: number, timeoutMs: number) => Promise<void>,
): ComposerSubmitDeps {
  return {
    platform,
    mkdirSync: (dirPath) => fs.mkdirSync(dirPath, { recursive: true }),
    writeFileSync: (filePath, buffer) => fs.writeFileSync(filePath, buffer),
    dataUrlToPngBuffer,
    writeToPty,
    generateRequestId: () =>
      `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    waitForPtyOutput,
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

  // Build an ordered list of paste payloads. Between each paste and
  // before the final \r, we wait for PTY output rather than using a
  // fixed delay — the CLI re-renders after processing each paste,
  // producing stdout. Seeing output confirms the paste state is
  // committed, so the next write won't race against async state updates.
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
      const payload = buildBracketedPaste(data);

      writePtyData(request.ptyId, payload, deps, stage, "pty-write-failed");

      // Wait for the CLI to process this paste before sending the next
      // one or the submit key.
      await deps.waitForPtyOutput(request.ptyId, 500);
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
