import fs from "node:fs";
import path from "node:path";
import {
  checkHydraInstructionsStatus,
  syncHydraInstructions,
  type InitInstructionResult,
} from "../hydra/src/init.ts";
import {
  checkTaskInstructionsStatus,
  syncTaskInstructions,
  type TaskInstructionResult,
} from "./task-instructions";

// Each section installed into a project's CLAUDE.md / AGENTS.md is owned by a
// distinct module. The UI surfaces them as a single "instructions" check and
// install: one prompt, one click, all sections covered. New sections (e.g. a
// future Computer Use guide) plug in here without changing the UI contract.
export type ProjectInstructionFileResult =
  | InitInstructionResult
  | TaskInstructionResult;

export interface EnableHydraForProjectSuccess {
  ok: true;
  repoPath: string;
  changed: boolean;
  files: ProjectInstructionFileResult[];
}

export interface EnableHydraForProjectFailure {
  ok: false;
  error: string;
}

export type EnableHydraForProjectResult =
  | EnableHydraForProjectSuccess
  | EnableHydraForProjectFailure;

export type HydraInjectStatus = "missing" | "outdated" | "current";

const STATUS_RANK: Record<HydraInjectStatus, number> = {
  current: 0,
  outdated: 1,
  missing: 2,
};

function worstStatus(...statuses: HydraInjectStatus[]): HydraInjectStatus {
  return statuses.reduce<HydraInjectStatus>(
    (worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst),
    "current",
  );
}

export function checkHydraProjectStatus(repoPath: string): HydraInjectStatus {
  try {
    const resolvedPath = path.resolve(repoPath);
    const hydraStatus = checkHydraInstructionsStatus(resolvedPath);

    // "missing" means the user has never opted into TermCanvas instructions for
    // this project — surface the prompt so they can choose to install. Anything
    // else means they already opted in; silently heal forward for outdated text
    // and for newly-introduced sections (e.g. Task) added in later releases.
    if (hydraStatus === "missing") return "missing";

    const taskStatus = checkTaskInstructionsStatus(resolvedPath);
    if (hydraStatus === "current" && taskStatus === "current") return "current";

    syncHydraInstructions(resolvedPath);
    syncTaskInstructions(resolvedPath);
    return worstStatus(
      checkHydraInstructionsStatus(resolvedPath),
      checkTaskInstructionsStatus(resolvedPath),
    );
  } catch {
    return "missing";
  }
}

export function enableHydraForProject(
  repoPath: string,
): EnableHydraForProjectResult {
  try {
    const resolvedPath = path.resolve(repoPath);
    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        error: `Project path is not a directory: ${resolvedPath}`,
      };
    }

    const hydraFiles = syncHydraInstructions(resolvedPath);
    const taskFiles = syncTaskInstructions(resolvedPath);
    const files: ProjectInstructionFileResult[] = [...hydraFiles, ...taskFiles];
    return {
      ok: true,
      repoPath: resolvedPath,
      changed: files.some((file) => file.status !== "unchanged"),
      files,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
