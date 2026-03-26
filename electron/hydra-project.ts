import fs from "node:fs";
import path from "node:path";
import {
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
