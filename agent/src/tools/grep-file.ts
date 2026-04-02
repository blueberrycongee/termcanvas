import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";

const DEFAULT_MAX_RESULTS = 50;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "__pycache__", ".venv"]);

const inputSchema = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  path: z.string().optional().describe("File or directory to search in (defaults to cwd)"),
  glob: z.string().optional().describe("Glob pattern to filter files (e.g. '*.ts')"),
  max_results: z.number().optional().describe("Maximum matches to return (default 50)"),
});

function isBinary(buffer: Buffer): boolean {
  const check = buffer.subarray(0, 8192);
  for (let i = 0; i < check.length; i++) {
    if (check[i] === 0) return true;
  }
  return false;
}

function matchGlob(filename: string, globPattern: string): boolean {
  const regex = globPattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`).test(filename);
}

function* walkFiles(dir: string, fileGlob?: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full, fileGlob);
    } else if (entry.isFile()) {
      if (fileGlob && !matchGlob(entry.name, fileGlob)) continue;
      yield full;
    }
  }
}

interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

export const grepFileTool: Tool<typeof inputSchema.shape> = {
  name: "GrepFile",
  description: "Search file contents with a regex pattern. Returns matching lines with file paths and line numbers.",
  inputSchema,
  isReadOnly: true,

  async call(input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    const searchPath = path.resolve(input.path ?? process.cwd());
    const maxResults = input.max_results ?? DEFAULT_MAX_RESULTS;

    let regex: RegExp;
    try {
      regex = new RegExp(input.pattern, "g");
    } catch (err) {
      return {
        content: `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
        is_error: true,
      };
    }

    const matches: GrepMatch[] = [];
    let filesSearched = 0;

    const searchFile = (filePath: string): void => {
      if (matches.length >= maxResults) return;

      let raw: Buffer;
      try {
        raw = fs.readFileSync(filePath);
      } catch {
        return;
      }

      if (isBinary(raw)) return;
      filesSearched++;

      const text = raw.toString("utf-8");
      const lines = text.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxResults) break;
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          matches.push({
            file: filePath,
            line: i + 1,
            text: lines[i].slice(0, 200),
          });
        }
      }
    };

    try {
      const stat = fs.statSync(searchPath);
      if (stat.isFile()) {
        searchFile(searchPath);
      } else if (stat.isDirectory()) {
        for (const file of walkFiles(searchPath, input.glob)) {
          if (matches.length >= maxResults) break;
          searchFile(file);
        }
      } else {
        return { content: `Error: ${searchPath} is not a file or directory`, is_error: true };
      }
    } catch (err) {
      return {
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        is_error: true,
      };
    }

    if (matches.length === 0) {
      return { content: `No matches found for /${input.pattern}/ in ${searchPath} (searched ${filesSearched} files)` };
    }

    const lines = matches.map((m) => `${m.file}:${m.line}:${m.text}`);
    let output = `Found ${matches.length} match(es) for /${input.pattern}/ (searched ${filesSearched} files)`;
    if (matches.length >= maxResults) {
      output += ` — results capped at ${maxResults}`;
    }
    output += "\n" + lines.join("\n");

    return { content: output };
  },
};
