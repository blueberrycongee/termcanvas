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

export interface GitStashEntry {
  index: number;
  message: string;
  hash: string;
  date: string;
}

export interface GitTagInfo {
  name: string;
  hash: string;
  isAnnotated: boolean;
  message: string;
  date: string;
}

export interface GitRemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitBlameEntry {
  hash: string;
  author: string;
  date: string;
  lineStart: number;
  lineCount: number;
  content: string;
}

export interface GitFileDiff {
  hunks: string[];
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
}

export type GitMergeState =
  | { type: "none" }
  | { type: "merge" }
  | { type: "rebase"; current: string; total: string }
  | { type: "cherry-pick" };

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
  const ops: Promise<string>[] = [];
  if (trackedPaths.length > 0) {
    ops.push(execGitText(worktreePath, ["checkout", "--", ...trackedPaths]));
  }
  if (untrackedPaths.length > 0) {
    ops.push(execGitText(worktreePath, ["clean", "-f", "--", ...untrackedPaths]));
  }
  await Promise.all(ops);
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

// ── Amend ──

export async function amendCommit(worktreePath: string, message: string): Promise<string> {
  const result = await execGitText(worktreePath, ["commit", "--amend", "-m", message]);
  const match = result.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
  return match?.[1] ?? "";
}

// ── Stash ──

export async function listStashes(worktreePath: string): Promise<GitStashEntry[]> {
  const raw = await execGitText(worktreePath, [
    "stash", "list", "--format=%H%x09%aI%x09%s",
  ]);
  return raw.trim().split("\n").filter(Boolean).map((line, i) => {
    const [hash, date, message] = line.split("\t");
    return { index: i, hash, date, message };
  });
}

export async function createStash(
  worktreePath: string,
  message: string,
  includeUntracked: boolean,
): Promise<void> {
  const args = ["stash", "push"];
  if (includeUntracked) args.push("--include-untracked");
  if (message) args.push("-m", message);
  await execGitText(worktreePath, args);
}

export async function applyStash(worktreePath: string, index: number): Promise<void> {
  await execGitText(worktreePath, ["stash", "apply", `stash@{${index}}`]);
}

export async function popStash(worktreePath: string, index: number): Promise<void> {
  await execGitText(worktreePath, ["stash", "pop", `stash@{${index}}`]);
}

export async function dropStash(worktreePath: string, index: number): Promise<void> {
  await execGitText(worktreePath, ["stash", "drop", `stash@{${index}}`]);
}

// ── Branch management ──

export async function createBranch(
  worktreePath: string,
  name: string,
  startPoint?: string,
): Promise<void> {
  const args = ["checkout", "-b", name];
  if (startPoint) args.push(startPoint);
  await execGitText(worktreePath, args);
}

export async function deleteBranch(
  worktreePath: string,
  name: string,
  force: boolean,
): Promise<void> {
  await execGitText(worktreePath, ["branch", force ? "-D" : "-d", name]);
}

export async function renameBranch(
  worktreePath: string,
  oldName: string,
  newName: string,
): Promise<void> {
  await execGitText(worktreePath, ["branch", "-m", oldName, newName]);
}

// ── Tags ──

export async function listTags(worktreePath: string): Promise<GitTagInfo[]> {
  const raw = await execGitText(worktreePath, [
    "tag", "-l", "--sort=-creatordate",
    "--format=%(refname:short)%09%(objectname:short)%09%(objecttype)%09%(creatordate:iso-strict)%09%(contents:subject)",
  ]);
  return raw.trim().split("\n").filter(Boolean).map((line) => {
    const [name, hash, type, date, message] = line.split("\t");
    return { name, hash, isAnnotated: type === "tag", message: message ?? "", date: date ?? "" };
  });
}

export async function createTag(
  worktreePath: string,
  name: string,
  ref: string,
  message?: string,
): Promise<void> {
  if (message) {
    await execGitText(worktreePath, ["tag", "-a", name, ref, "-m", message]);
  } else {
    await execGitText(worktreePath, ["tag", name, ref]);
  }
}

export async function deleteTag(worktreePath: string, name: string): Promise<void> {
  await execGitText(worktreePath, ["tag", "-d", name]);
}

// ── Remotes ──

export async function listRemotes(worktreePath: string): Promise<GitRemoteInfo[]> {
  const raw = await execGitText(worktreePath, ["remote", "-v"]);
  const map = new Map<string, GitRemoteInfo>();
  for (const line of raw.trim().split("\n").filter(Boolean)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match) continue;
    const [, name, url, type] = match;
    if (!map.has(name)) map.set(name, { name, fetchUrl: "", pushUrl: "" });
    const entry = map.get(name)!;
    if (type === "fetch") entry.fetchUrl = url;
    else entry.pushUrl = url;
  }
  return [...map.values()];
}

export async function addRemote(worktreePath: string, name: string, url: string): Promise<void> {
  await execGitText(worktreePath, ["remote", "add", name, url]);
}

export async function removeRemote(worktreePath: string, name: string): Promise<void> {
  await execGitText(worktreePath, ["remote", "remove", name]);
}

export async function renameRemote(worktreePath: string, oldName: string, newName: string): Promise<void> {
  await execGitText(worktreePath, ["remote", "rename", oldName, newName]);
}

// ── Fetch ──

export async function gitFetch(worktreePath: string, remote?: string): Promise<string> {
  const args = ["fetch"];
  if (remote) args.push(remote);
  else args.push("--all");
  return execGitRemote(worktreePath, args);
}

// ── Merge / Rebase / Cherry-pick ──

export async function gitMerge(worktreePath: string, ref: string): Promise<string> {
  return execGitText(worktreePath, ["merge", ref]);
}

export async function gitMergeAbort(worktreePath: string): Promise<void> {
  await execGitText(worktreePath, ["merge", "--abort"]);
}

export async function gitRebase(worktreePath: string, ref: string): Promise<string> {
  return execGitText(worktreePath, ["rebase", ref]);
}

export async function gitRebaseAbort(worktreePath: string): Promise<void> {
  await execGitText(worktreePath, ["rebase", "--abort"]);
}

export async function gitRebaseContinue(worktreePath: string): Promise<string> {
  return execGitText(worktreePath, ["rebase", "--continue"]);
}

export async function gitCherryPick(worktreePath: string, hash: string): Promise<string> {
  return execGitText(worktreePath, ["cherry-pick", hash]);
}

export async function gitCherryPickAbort(worktreePath: string): Promise<void> {
  await execGitText(worktreePath, ["cherry-pick", "--abort"]);
}

// ── Merge state detection ──

export async function getMergeState(worktreePath: string): Promise<GitMergeState> {
  try {
    const gitDir = (await execGitText(worktreePath, ["rev-parse", "--git-dir"], 1024 * 1024)).trim();
    const absGitDir = path.isAbsolute(gitDir) ? gitDir : path.resolve(worktreePath, gitDir);

    const { statSync } = await import("node:fs");
    const exists = (p: string) => { try { statSync(p); return true; } catch { return false; } };

    if (exists(path.join(absGitDir, "rebase-merge")) || exists(path.join(absGitDir, "rebase-apply"))) {
      let current = "?";
      let total = "?";
      try {
        const dir = exists(path.join(absGitDir, "rebase-merge")) ? "rebase-merge" : "rebase-apply";
        const { readFileSync } = await import("node:fs");
        current = readFileSync(path.join(absGitDir, dir, "msgnum"), "utf-8").trim();
        total = readFileSync(path.join(absGitDir, dir, "end"), "utf-8").trim();
      } catch {}
      return { type: "rebase", current, total };
    }
    if (exists(path.join(absGitDir, "MERGE_HEAD"))) {
      return { type: "merge" };
    }
    if (exists(path.join(absGitDir, "CHERRY_PICK_HEAD"))) {
      return { type: "cherry-pick" };
    }
  } catch {}
  return { type: "none" };
}

// ── File diff ──

export async function getFileDiff(
  worktreePath: string,
  filePath: string,
  staged: boolean,
): Promise<GitFileDiff> {
  try {
    const args = staged
      ? ["diff", "--cached", "--", filePath]
      : ["diff", "--", filePath];
    const raw = await execGitText(worktreePath, args);

    if (!raw.trim()) {
      // Could be untracked
      const untrackedArgs = ["diff", "--no-index", "/dev/null", filePath];
      try {
        const untrackedDiff = await execGitText(worktreePath, untrackedArgs);
        return { hunks: splitDiffHunks(untrackedDiff), isNew: true, isDeleted: false, isBinary: false };
      } catch (err: unknown) {
        // git diff --no-index exits 1 on difference — stderr has the diff
        const execErr = err as { stdout?: string };
        if (execErr.stdout) {
          return { hunks: splitDiffHunks(execErr.stdout), isNew: true, isDeleted: false, isBinary: false };
        }
        return { hunks: [], isNew: true, isDeleted: false, isBinary: false };
      }
    }

    const isBinary = raw.includes("Binary files");
    return {
      hunks: isBinary ? [] : splitDiffHunks(raw),
      isNew: false,
      isDeleted: false,
      isBinary,
    };
  } catch {
    return { hunks: [], isNew: false, isDeleted: false, isBinary: false };
  }
}

function splitDiffHunks(diffOutput: string): string[] {
  const hunks: string[] = [];
  const lines = diffOutput.split("\n");
  let current: string[] = [];
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (inHunk && current.length > 0) hunks.push(current.join("\n"));
      current = [line];
      inHunk = true;
    } else if (inHunk) {
      current.push(line);
    }
  }
  if (inHunk && current.length > 0) hunks.push(current.join("\n"));
  return hunks;
}

// ── Partial staging (hunk-level) ──

export async function stageHunk(
  worktreePath: string,
  filePath: string,
  hunkHeader: string,
): Promise<void> {
  // Get the full diff, find the target hunk, and apply just that hunk via git apply
  const diff = await execGitText(worktreePath, ["diff", "--", filePath]);
  const patch = extractHunkPatch(diff, filePath, hunkHeader);
  if (!patch) throw new Error("Hunk not found");
  await applyPatch(worktreePath, patch, ["--cached"]);
}

export async function unstageHunk(
  worktreePath: string,
  filePath: string,
  hunkHeader: string,
): Promise<void> {
  const diff = await execGitText(worktreePath, ["diff", "--cached", "--", filePath]);
  const patch = extractHunkPatch(diff, filePath, hunkHeader);
  if (!patch) throw new Error("Hunk not found");
  await applyPatch(worktreePath, patch, ["--cached", "--reverse"]);
}

function extractHunkPatch(fullDiff: string, _filePath: string, targetHunkHeader: string): string | null {
  const lines = fullDiff.split("\n");
  // Collect the diff header (everything before the first @@ line)
  const headerLines: string[] = [];
  let i = 0;
  while (i < lines.length && !lines[i].startsWith("@@")) {
    headerLines.push(lines[i]);
    i++;
  }
  if (headerLines.length === 0) return null;

  // Find the target hunk
  while (i < lines.length) {
    if (lines[i].startsWith("@@") && lines[i].includes(targetHunkHeader)) {
      const hunkLines: string[] = [lines[i]];
      i++;
      while (i < lines.length && !lines[i].startsWith("@@")) {
        hunkLines.push(lines[i]);
        i++;
      }
      return [...headerLines, ...hunkLines, ""].join("\n");
    }
    i++;
  }
  return null;
}

async function applyPatch(worktreePath: string, patch: string, extraArgs: string[]): Promise<void> {
  const { execFile: execFileCb } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const proc = execFileCb(
      "git",
      ["apply", ...extraArgs],
      { cwd: worktreePath, encoding: "utf-8", maxBuffer: DEFAULT_MAX_BUFFER },
      (err) => { if (err) reject(err); else resolve(); },
    );
    proc.stdin?.write(patch);
    proc.stdin?.end();
  });
}

// ── Blame ──

export async function getBlame(
  worktreePath: string,
  filePath: string,
): Promise<GitBlameEntry[]> {
  const raw = await execGitText(worktreePath, [
    "blame", "--porcelain", filePath,
  ]);

  const entries: GitBlameEntry[] = [];
  const lines = raw.split("\n");
  let i = 0;

  while (i < lines.length) {
    const headerMatch = lines[i].match(/^([a-f0-9]{40})\s+\d+\s+(\d+)\s+(\d+)$/);
    if (!headerMatch) { i++; continue; }

    const [, hash, lineStartStr, lineCountStr] = headerMatch;
    let author = "";
    let date = "";
    i++;

    while (i < lines.length && !lines[i].startsWith("\t")) {
      if (lines[i].startsWith("author ")) author = lines[i].slice(7);
      else if (lines[i].startsWith("author-time ")) {
        const ts = Number.parseInt(lines[i].slice(12), 10);
        date = new Date(ts * 1000).toISOString();
      }
      i++;
    }

    const content = i < lines.length && lines[i].startsWith("\t") ? lines[i].slice(1) : "";
    if (i < lines.length) i++;

    entries.push({
      hash,
      author,
      date,
      lineStart: Number.parseInt(lineStartStr, 10),
      lineCount: Number.parseInt(lineCountStr, 10),
      content,
    });
  }
  return entries;
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
