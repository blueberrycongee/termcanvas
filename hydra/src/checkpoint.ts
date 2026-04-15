import { execFileSync } from "node:child_process";
import { HydraError } from "./errors.ts";

export interface CheckpointResult {
  /** Stash object SHA (if dirty) or HEAD SHA (if clean). */
  sha: string;
  /** HEAD commit at checkpoint time — rollback target. */
  head_sha: string;
  /** True if `git stash create` produced a snapshot (worktree was dirty). */
  was_dirty: boolean;
}

/**
 * Capture a snapshot of the worktree state using `git stash create`.
 * Does NOT modify the working tree, index, HEAD, or any visible ref.
 *
 * If the worktree is dirty, the stash object is anchored to a custom
 * ref (`refs/hydra/checkpoints/<refName>`) to prevent garbage collection.
 * If clean, only the HEAD SHA is recorded — no ref is needed.
 */
export function createCheckpoint(
  worktreePath: string,
  refName: string,
): CheckpointResult {
  const headSha = getCurrentHead(worktreePath);

  let stashSha: string;
  try {
    stashSha = execFileSync(
      "git",
      ["stash", "create", "--include-untracked"],
      { cwd: worktreePath, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    throw new HydraError(
      `Failed to create checkpoint in ${worktreePath}: ${error instanceof Error ? error.message : String(error)}`,
      { errorCode: "CHECKPOINT_CREATE_FAILED", stage: "checkpoint.create" },
    );
  }

  if (!stashSha) {
    // Clean worktree — no stash object created
    return { sha: headSha, head_sha: headSha, was_dirty: false };
  }

  // Anchor the stash object to prevent GC
  try {
    execFileSync(
      "git",
      ["update-ref", `refs/hydra/checkpoints/${refName}`, stashSha],
      { cwd: worktreePath, encoding: "utf-8", stdio: "pipe" },
    );
  } catch (error) {
    throw new HydraError(
      `Failed to anchor checkpoint ref for ${refName}: ${error instanceof Error ? error.message : String(error)}`,
      { errorCode: "CHECKPOINT_REF_FAILED", stage: "checkpoint.create" },
    );
  }

  return { sha: stashSha, head_sha: headSha, was_dirty: true };
}

/**
 * Restore the worktree to the state captured by a checkpoint.
 *
 * For v1, this always resets to `head_sha` (the HEAD commit at checkpoint
 * time) and cleans untracked files. Dirty-state restoration via
 * `git stash apply` is deferred to avoid `.hydra/` conflicts when
 * `own_worktree` is false.
 */
export function rollbackToCheckpoint(
  worktreePath: string,
  checkpoint: CheckpointResult,
): void {
  try {
    execFileSync(
      "git",
      ["reset", "--hard", checkpoint.head_sha],
      { cwd: worktreePath, encoding: "utf-8", stdio: "pipe" },
    );
  } catch (error) {
    throw new HydraError(
      `Failed to reset worktree to ${checkpoint.head_sha}: ${error instanceof Error ? error.message : String(error)}`,
      { errorCode: "CHECKPOINT_RESET_FAILED", stage: "checkpoint.rollback" },
    );
  }

  try {
    execFileSync(
      "git",
      ["clean", "-fd"],
      { cwd: worktreePath, encoding: "utf-8", stdio: "pipe" },
    );
  } catch {
    // Non-fatal: clean may fail if a file is locked; the reset already
    // restored tracked files which is the critical part.
  }
}

/**
 * Remove the custom ref that anchors a checkpoint's stash object.
 * Safe to call even if the ref does not exist.
 */
export function removeCheckpointRef(
  worktreePath: string,
  refName: string,
): void {
  try {
    execFileSync(
      "git",
      ["update-ref", "-d", `refs/hydra/checkpoints/${refName}`],
      { cwd: worktreePath, encoding: "utf-8", stdio: "pipe" },
    );
  } catch {
    // Ref may already be gone — ignore.
  }
}

/**
 * Return the current HEAD SHA of the given worktree.
 */
export function getCurrentHead(worktreePath: string): string {
  try {
    return execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: worktreePath, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    throw new HydraError(
      `Failed to read HEAD in ${worktreePath}: ${error instanceof Error ? error.message : String(error)}`,
      { errorCode: "CHECKPOINT_HEAD_FAILED", stage: "checkpoint.head" },
    );
  }
}
