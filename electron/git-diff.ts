import { execFile } from "child_process";
import { open, readFile } from "fs/promises";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const MAX_FILE_CONCURRENCY = 5;
const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico",
]);
const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

export interface ProjectDiffFile {
  name: string;
  additions: number;
  deletions: number;
  binary: boolean;
  isImage: boolean;
  imageOld: string | null;
  imageNew: string | null;
}

export interface ApiDiffSummaryFile {
  name: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

function listLines(raw: string): string[] {
  return raw.trim().split("\n").filter(Boolean);
}

function toDataUrl(mime: string, data: Buffer): string {
  return `data:${mime};base64,${data.toString("base64")}`;
}

function countLines(content: string): number {
  return splitContentLines(content).length;
}

function splitContentLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function buildTextDiff(name: string, content: string): string {
  const lines = splitContentLines(content);
  const addLines = lines.map((line) => `+${line}`).join("\n");
  return `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,${lines.length} @@\n${addLines}\n`;
}

async function execGitText(
  worktreePath: string,
  args: string[],
  maxBuffer?: number,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: worktreePath,
    encoding: "utf-8",
    ...(maxBuffer ? { maxBuffer } : {}),
  });
  return stdout;
}

async function execGitBuffer(
  worktreePath: string,
  args: string[],
  maxBuffer?: number,
): Promise<Buffer> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: worktreePath,
    encoding: "buffer",
    ...(maxBuffer ? { maxBuffer } : {}),
  }) as { stdout: Buffer; stderr: Buffer };
  return stdout;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );
  return results;
}

async function detectBinaryByNullBytes(filePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, "r");
    const probe = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(probe, 0, 8192, 0);
    return probe.subarray(0, bytesRead).includes(0);
  } catch {
    return false;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {}
    }
  }
}

async function buildTrackedProjectDiffFile(
  worktreePath: string,
  name: string,
  add: string,
  del: string,
): Promise<ProjectDiffFile> {
  const binary = add === "-";
  const ext = path.extname(name).toLowerCase();
  const isImage = binary && IMAGE_EXTS.has(ext);
  let imageOld: string | null = null;
  let imageNew: string | null = null;

  if (isImage) {
    const mime = MIME_MAP[ext] ?? "image/png";
    try {
      const oldBuf = await execGitBuffer(
        worktreePath,
        ["show", `HEAD:${name}`],
        5 * 1024 * 1024,
      );
      imageOld = toDataUrl(mime, oldBuf);
    } catch {}
    try {
      const newBuf = await readFile(path.join(worktreePath, name));
      imageNew = toDataUrl(mime, newBuf);
    } catch {}
  }

  return {
    name,
    additions: binary ? 0 : parseInt(add, 10),
    deletions: binary ? 0 : parseInt(del, 10),
    binary,
    isImage,
    imageOld,
    imageNew,
  };
}

async function buildUntrackedProjectDiffEntry(
  worktreePath: string,
  name: string,
): Promise<{ file: ProjectDiffFile; diff: string } | null> {
  const filePath = path.join(worktreePath, name);
  const ext = path.extname(name).toLowerCase();
  const isImage = IMAGE_EXTS.has(ext);
  let isBinary = isImage;

  if (!isBinary) {
    isBinary = await detectBinaryByNullBytes(filePath);
  }

  if (isBinary) {
    const mime = MIME_MAP[ext] ?? "application/octet-stream";
    let imageNew: string | null = null;
    if (isImage) {
      try {
        const newBuf = await readFile(filePath);
        imageNew = toDataUrl(mime, newBuf);
      } catch {}
    }

    return {
      file: {
        name,
        additions: 0,
        deletions: 0,
        binary: true,
        isImage,
        imageOld: null,
        imageNew,
      },
      diff: `diff --git a/${name} b/${name}\nnew file\nBinary file\n`,
    };
  }

  try {
    const content = await readFile(filePath, "utf-8");
    return {
      file: {
        name,
        additions: countLines(content),
        deletions: 0,
        binary: false,
        isImage: false,
        imageOld: null,
        imageNew: null,
      },
      diff: buildTextDiff(name, content),
    };
  } catch {
    return null;
  }
}

async function buildApiSummaryUntrackedFile(
  worktreePath: string,
  name: string,
): Promise<ApiDiffSummaryFile> {
  try {
    const content = await readFile(path.join(worktreePath, name), "utf-8");
    return {
      name,
      additions: countLines(content),
      deletions: 0,
      binary: false,
    };
  } catch {
    return {
      name,
      additions: 0,
      deletions: 0,
      binary: true,
    };
  }
}

async function buildApiUntrackedDiff(
  worktreePath: string,
  name: string,
): Promise<string> {
  try {
    const content = await readFile(path.join(worktreePath, name), "utf-8");
    return buildTextDiff(name, content);
  } catch {
    return `diff --git a/${name} b/${name}\nnew file\nBinary file\n`;
  }
}

export async function getProjectDiff(
  worktreePath: string,
): Promise<{ diff: string; files: ProjectDiffFile[] }> {
  const [diff, numstat, untrackedRaw] = await Promise.all([
    execGitText(worktreePath, ["diff", "HEAD"], 10 * 1024 * 1024),
    execGitText(worktreePath, ["diff", "HEAD", "--numstat"]),
    execGitText(worktreePath, ["ls-files", "--others", "--exclude-standard"]),
  ]);

  const trackedFiles = await mapWithConcurrency(
    listLines(numstat),
    MAX_FILE_CONCURRENCY,
    async (line) => {
      const [add, del, name] = line.split("\t");
      return buildTrackedProjectDiffFile(worktreePath, name, add, del);
    },
  );

  const untrackedEntries = await mapWithConcurrency(
    listLines(untrackedRaw),
    MAX_FILE_CONCURRENCY,
    (name) => buildUntrackedProjectDiffEntry(worktreePath, name),
  );

  return {
    diff: diff + untrackedEntries.map((entry) => entry?.diff ?? "").join(""),
    files: [
      ...trackedFiles,
      ...untrackedEntries.flatMap((entry) => (entry ? [entry.file] : [])),
    ],
  };
}

export async function getApiDiff(
  worktreePath: string,
  summary: true,
): Promise<{ worktree: string; files: ApiDiffSummaryFile[] }>;
export async function getApiDiff(
  worktreePath: string,
  summary: false,
): Promise<{ worktree: string; diff: string }>;
export async function getApiDiff(
  worktreePath: string,
  summary: boolean,
): Promise<{ worktree: string; files: ApiDiffSummaryFile[] } | {
  worktree: string;
  diff: string;
}> {
  const untrackedRaw = await execGitText(
    worktreePath,
    ["ls-files", "--others", "--exclude-standard"],
  );
  const untrackedNames = listLines(untrackedRaw);

  if (summary) {
    const numstat = await execGitText(worktreePath, ["diff", "HEAD", "--numstat"]);
    const trackedFiles = listLines(numstat).map((line) => {
      const [add, del, name] = line.split("\t");
      const binary = add === "-";
      return {
        name,
        additions: binary ? 0 : parseInt(add, 10),
        deletions: binary ? 0 : parseInt(del, 10),
        binary,
      };
    });

    const untrackedFiles = await mapWithConcurrency(
      untrackedNames,
      MAX_FILE_CONCURRENCY,
      (name) => buildApiSummaryUntrackedFile(worktreePath, name),
    );

    return {
      worktree: worktreePath,
      files: [...trackedFiles, ...untrackedFiles],
    };
  }

  const diff = await execGitText(
    worktreePath,
    ["diff", "HEAD"],
    10 * 1024 * 1024,
  );
  const untrackedDiffs = await mapWithConcurrency(
    untrackedNames,
    MAX_FILE_CONCURRENCY,
    (name) => buildApiUntrackedDiff(worktreePath, name),
  );

  return {
    worktree: worktreePath,
    diff: diff + untrackedDiffs.join(""),
  };
}
