import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { ProjectDiffFile } from "./git-diff";

const execFileAsync = promisify(execFile);
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".bmp",
  ".ico",
]);
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

export interface GitBranchInfo {
  name: string;
  hash: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitLogEntry {
  hash: string;
  parents: string[];
  refs: string[];
  author: string;
  date: string;
  message: string;
}

export interface GitCommitDetail {
  message: string;
  diff: string;
  files: ProjectDiffFile[];
}

export type GitFileStatus = "M" | "A" | "D" | "R" | "C" | "U" | "?";

export interface GitStatusEntry {
  path: string;
  status: GitFileStatus;
  staged: boolean;
  originalPath?: string;
}

async function execGitText(
  worktreePath: string,
  args: string[],
  maxBuffer = DEFAULT_MAX_BUFFER,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: worktreePath,
    encoding: "utf-8",
    maxBuffer,
  });
  return stdout;
}

function parseTracking(raw: string): { ahead: number; behind: number } {
  if (!raw || raw.includes("gone")) {
    return { ahead: 0, behind: 0 };
  }

  const aheadMatch = raw.match(/ahead (\d+)/);
  const behindMatch = raw.match(/behind (\d+)/);
  return {
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1], 10) : 0,
  };
}

function parseRefs(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildProjectDiffFile(name: string, additionsRaw: string, deletionsRaw: string): ProjectDiffFile {
  const binary = additionsRaw === "-" || deletionsRaw === "-";
  const displayName = name.includes("=>")
    ? name.slice(name.lastIndexOf("=>") + 2).replace(/[{}]/g, "").trim()
    : name;
  const extension = path.extname(displayName).toLowerCase();

  return {
    name,
    additions: binary ? 0 : Number.parseInt(additionsRaw, 10),
    deletions: binary ? 0 : Number.parseInt(deletionsRaw, 10),
    binary,
    isImage: IMAGE_EXTENSIONS.has(extension),
    imageOld: null,
    imageNew: null,
  };
}

async function getCommitBase(worktreePath: string, hash: string): Promise<string> {
  const parentsRaw = await execGitText(worktreePath, ["show", "--quiet", "--format=%P", hash], 1024 * 1024);
  const firstParent = parentsRaw.trim().split(" ").filter(Boolean)[0];
  return firstParent || EMPTY_TREE_HASH;
}

export async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    await execGitText(dirPath, ["rev-parse", "--git-dir"], 1024 * 1024);
    return true;
  } catch {
    return false;
  }
}

export async function getGitBranches(worktreePath: string): Promise<GitBranchInfo[]> {
  const raw = await execGitText(worktreePath, [
    "for-each-ref",
    "--format=%(refname)%09%(refname:short)%09%(objectname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)",
    "refs/heads",
    "refs/remotes",
  ]);

  const branches = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [refName, shortName, hash, headMarker, upstreamRaw, trackingRaw] = line.split("\t");
      const { ahead, behind } = parseTracking(trackingRaw ?? "");
      return {
        name: shortName,
        hash,
        isCurrent: headMarker === "*",
        isRemote: refName.startsWith("refs/remotes/"),
        upstream: upstreamRaw || null,
        ahead,
        behind,
      };
    })
    .filter((branch) => !branch.name.endsWith("/HEAD"));

  if (branches.some((branch) => branch.isCurrent)) {
    return branches;
  }

  try {
    const unbornHead = (await execGitText(
      worktreePath,
      ["symbolic-ref", "--short", "HEAD"],
      1024 * 1024,
    )).trim();
    if (unbornHead) {
      branches.unshift({
        name: unbornHead,
        hash: "",
        isCurrent: true,
        isRemote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
      });
    }
  } catch {
  }

  return branches;
}

export async function getGitLog(
  worktreePath: string,
  count = 200,
): Promise<GitLogEntry[]> {
  const raw = await execGitText(worktreePath, [
    "log",
    "--all",
    "--format=%H%x09%P%x09%D%x09%an%x09%aI%x09%s",
    "--topo-order",
    "-n",
    String(count),
  ]);

  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, parentsRaw, refsRaw, author, date, message] = line.split("\t");
      return {
        hash,
        parents: parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [],
        refs: parseRefs(refsRaw ?? ""),
        author,
        date,
        message,
      };
    });
}

export async function getGitCommitDetail(
  worktreePath: string,
  hash: string,
): Promise<GitCommitDetail | null> {
  try {
    const base = await getCommitBase(worktreePath, hash);
    const [messageRaw, diff, numstatRaw] = await Promise.all([
      execGitText(worktreePath, ["show", "--quiet", "--format=%B", hash], 1024 * 1024),
      execGitText(worktreePath, ["diff", "--find-renames", base, hash]),
      execGitText(worktreePath, ["diff", "--find-renames", "--numstat", base, hash]),
    ]);

    const files = numstatRaw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [additionsRaw, deletionsRaw, ...nameParts] = line.split("\t");
        return buildProjectDiffFile(nameParts.join("\t"), additionsRaw, deletionsRaw);
      });

    return {
      message: messageRaw.trimEnd(),
      diff,
      files,
    };
  } catch {
    return null;
  }
}

export async function checkoutGitRef(worktreePath: string, ref: string): Promise<void> {
  await execGitText(worktreePath, ["checkout", ref], DEFAULT_MAX_BUFFER);
}

export async function initGitRepo(worktreePath: string): Promise<void> {
  await execGitText(worktreePath, ["init", "-b", "main"], DEFAULT_MAX_BUFFER);
}

const STATUS_CODE_MAP: Record<string, GitFileStatus> = {
  M: "M",
  A: "A",
  D: "D",
  R: "R",
  C: "C",
  U: "U",
  T: "M", // type-change treated as modified
};

function mapStatusCode(code: string): GitFileStatus {
  return STATUS_CODE_MAP[code] ?? "M";
}

export function parseGitStatusOutput(raw: string): GitStatusEntry[] {
  if (!raw) return [];

  const entries: GitStatusEntry[] = [];
  const parts = raw.split("\0").filter(Boolean);

  let i = 0;
  while (i < parts.length) {
    const entry = parts[i];
    if (entry.length < 4) {
      i++;
      continue;
    }

    const x = entry[0];
    const y = entry[1];
    const filePath = entry.slice(3);

    if (x === "?" && y === "?") {
      entries.push({ path: filePath, status: "?", staged: false });
      i++;
      continue;
    }

    const isRenameOrCopy = x === "R" || x === "C";
    const originalPath = isRenameOrCopy ? parts[i + 1] : undefined;

    if (x !== " " && x !== "?") {
      entries.push({
        path: filePath,
        status: mapStatusCode(x),
        staged: true,
        ...(originalPath ? { originalPath } : {}),
      });
    }

    if (y !== " ") {
      entries.push({
        path: filePath,
        status: mapStatusCode(y),
        staged: false,
      });
    }

    i += isRenameOrCopy ? 2 : 1;
  }

  return entries;
}

export async function getGitStatus(worktreePath: string): Promise<GitStatusEntry[]> {
  const raw = await execGitText(worktreePath, ["status", "--porcelain=v1", "-z"]);
  return parseGitStatusOutput(raw);
}

export async function stageFiles(worktreePath: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await execGitText(worktreePath, ["add", "--", ...paths]);
}

export async function unstageFiles(worktreePath: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await execGitText(worktreePath, ["reset", "HEAD", "--", ...paths]);
}

export async function discardFiles(
  worktreePath: string,
  trackedPaths: string[],
  untrackedPaths: string[],
): Promise<void> {
  if (trackedPaths.length > 0) {
    await execGitText(worktreePath, ["checkout", "--", ...trackedPaths]);
  }
  if (untrackedPaths.length > 0) {
    await execGitText(worktreePath, ["clean", "-f", "--", ...untrackedPaths]);
  }
}

export async function createCommit(worktreePath: string, message: string): Promise<string> {
  const result = await execGitText(worktreePath, ["commit", "-m", message]);
  const match = result.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
  return match?.[1] ?? "";
}

export async function gitPush(worktreePath: string): Promise<string> {
  return execGitRemote(worktreePath, ["push"]);
}

export async function gitPull(worktreePath: string): Promise<string> {
  return execGitRemote(worktreePath, ["pull"]);
}

/**
 * Execute a git remote command (push/pull) with safeguards:
 * - GIT_TERMINAL_PROMPT=0 prevents hanging on auth prompts
 * - 30s timeout prevents indefinite hangs
 * - stderr is captured (git push/pull write progress to stderr)
 */
async function execGitRemote(
  worktreePath: string,
  args: string[],
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: worktreePath,
      encoding: "utf-8",
      maxBuffer: DEFAULT_MAX_BUFFER,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      signal: controller.signal,
    });
    return stdout || stderr;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "killed" in err && (err as { killed: boolean }).killed) {
      throw new Error(`git ${args[0]} timed out after 30s`);
    }
    const execErr = err as { stderr?: string; message?: string };
    const detail = execErr.stderr || execErr.message || "Unknown error";
    throw new Error(`git ${args[0]} failed: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }
}
