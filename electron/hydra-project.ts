import fs from "node:fs";
import path from "node:path";
import {
  checkHydraInstructionsStatus,
  syncHydraInstructions,
  type InitInstructionResult,
} from "../hydra/src/init.ts";

export interface EnableHydraForProjectSuccess {
  ok: true;
  repoPath: string;
  changed: boolean;
  files: InitInstructionResult[];
}

export interface EnableHydraForProjectFailure {
  ok: false;
  error: string;
}

export type EnableHydraForProjectResult =
  | EnableHydraForProjectSuccess
  | EnableHydraForProjectFailure;

export type HydraInjectStatus = "missing" | "outdated" | "current";

export function checkHydraProjectStatus(repoPath: string): HydraInjectStatus {
  try {
    const resolvedPath = path.resolve(repoPath);
    const status = checkHydraInstructionsStatus(resolvedPath);
    if (status !== "outdated") {
      return status;
    }

    // Heal forward for projects that already opted into Hydra but still
    // carry a stale instruction block from an older TermCanvas release.
    syncHydraInstructions(resolvedPath);
    return checkHydraInstructionsStatus(resolvedPath);
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

    const files = syncHydraInstructions(resolvedPath);
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
