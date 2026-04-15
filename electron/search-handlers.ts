import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import readline from "node:readline";

const execFileAsync = promisify(execFile);

export interface FileContentMatch {
  filePath: string;
  line: number;
  preview: string;
}

export interface SessionContentMatch {
  sessionId: string;
  filePath: string;
  lineNumber: number;
  preview: string;
}

const SEARCH_TIMEOUT = 5_000;
const MAX_FILE_RESULTS = 20;
const MAX_SESSION_RESULTS = 20;
const EXCLUDE_DIRS = ["node_modules", ".git", "dist", "build", ".next", "__pycache__", "thirdparty"];

/**
 * Search file contents using ripgrep (rg) or grep fallback.
 */
export async function searchFileContents(
  worktreePath: string,
  query: string,
  maxResults = MAX_FILE_RESULTS,
): Promise<FileContentMatch[]> {
  if (!query || !worktreePath) return [];

  // Try ripgrep first
  try {
    return await searchWithRipgrep(worktreePath, query, maxResults);
  } catch {
    // Fallback to grep
    try {
      return await searchWithGrep(worktreePath, query, maxResults);
    } catch {
      return [];
    }
  }
}

async function searchWithRipgrep(
  cwd: string,
  query: string,
  maxResults: number,
): Promise<FileContentMatch[]> {
  const args = [
    "--no-heading",
    "--line-number",
    "--max-count", String(maxResults),
    "--max-filesize", "1M",
    "-i", // case insensitive
  ];
  for (const d of EXCLUDE_DIRS) args.push("--glob", `!${d}/`);
  args.push("--", query);

  const { stdout } = await execFileAsync("rg", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 5 * 1024 * 1024,
    timeout: SEARCH_TIMEOUT,
  });

  return parseGrepOutput(stdout, cwd).slice(0, maxResults);
}

async function searchWithGrep(
  cwd: string,
  query: string,
  maxResults: number,
): Promise<FileContentMatch[]> {
  const excludeArgs = EXCLUDE_DIRS.flatMap((d) => ["--exclude-dir", d]);
  const args = [
    "-rn",
    "-i",
    "-m", String(maxResults),
    ...excludeArgs,
    "--", query, ".",
  ];

  const { stdout } = await execFileAsync("grep", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 5 * 1024 * 1024,
    timeout: SEARCH_TIMEOUT,
  });

  return parseGrepOutput(stdout, cwd).slice(0, maxResults);
}

function parseGrepOutput(stdout: string, cwd: string): FileContentMatch[] {
  const results: FileContentMatch[] = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line) continue;
    // Format: file:line:content  or  ./file:line:content
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (!match) continue;
    let [, file, lineNum, preview] = match;
    // Normalize path
    if (file.startsWith("./")) file = file.slice(2);
    results.push({
      filePath: path.resolve(cwd, file),
      line: Number.parseInt(lineNum, 10),
      preview: preview.trim().slice(0, 200),
    });
  }
  return results;
}

/**
 * Search session JSONL file contents for a text query.
 * Scans known session directories for matching lines.
 */
export async function searchSessionContents(
  query: string,
  maxResults = MAX_SESSION_RESULTS,
): Promise<SessionContentMatch[]> {
  if (!query) return [];

  const lowerQuery = query.toLowerCase();
  const results: SessionContentMatch[] = [];

  // Find session directories
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const claudeDir = path.join(home, ".claude", "projects");

  if (!fs.existsSync(claudeDir)) return [];

  // Use grep on the sessions directory for speed
  try {
    const excludeArgs = EXCLUDE_DIRS.flatMap((d) => ["--exclude-dir", d]);
    const { stdout } = await execFileAsync(
      "grep",
      ["-rn", "-i", "-l", "-m", "1", ...excludeArgs, "--include", "*.jsonl", "--", query, claudeDir],
      {
        encoding: "utf-8",
        maxBuffer: 5 * 1024 * 1024,
        timeout: SEARCH_TIMEOUT,
      },
    );

    const matchingFiles = stdout.trim().split("\n").filter(Boolean).slice(0, maxResults);

    for (const filePath of matchingFiles) {
      // Read a few matching lines from the file
      const matches = await extractMatchingLines(filePath, lowerQuery, 2);
      for (const m of matches) {
        results.push({
          sessionId: path.basename(filePath, ".jsonl"),
          filePath,
          lineNumber: m.lineNumber,
          preview: m.preview,
        });
        if (results.length >= maxResults) return results;
      }
    }
  } catch {
    // grep not available or no matches
  }

  return results;
}

async function extractMatchingLines(
  filePath: string,
  lowerQuery: string,
  maxLines: number,
): Promise<Array<{ lineNumber: number; preview: string }>> {
  const results: Array<{ lineNumber: number; preview: string }> = [];

  try {
    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;

    for await (const line of rl) {
      lineNumber++;
      if (!line.toLowerCase().includes(lowerQuery)) continue;

      // Try to parse as JSON and extract meaningful text
      let preview = "";
      try {
        const obj = JSON.parse(line);
        if (obj.message?.content) {
          const content = typeof obj.message.content === "string"
            ? obj.message.content
            : JSON.stringify(obj.message.content);
          preview = content.slice(0, 200);
        } else if (obj.content) {
          preview = String(obj.content).slice(0, 200);
        }
      } catch {
        preview = line.slice(0, 200);
      }

      if (preview) {
        results.push({ lineNumber, preview });
        if (results.length >= maxLines) break;
      }
    }

    rl.close();
    stream.destroy();
  } catch {
    // File read error
  }

  return results;
}
