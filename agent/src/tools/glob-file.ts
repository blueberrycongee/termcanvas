import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";

const MAX_RESULTS = 500;

const inputSchema = z.object({
  pattern: z.string().describe("Glob pattern to match files (e.g. '**/*.ts', 'src/**/*.tsx')"),
  path: z.string().optional().describe("Directory to search in (defaults to cwd)"),
});

export const globFileTool: Tool<typeof inputSchema.shape> = {
  name: "GlobFile",
  description: "Find files matching a glob pattern. Returns sorted file paths.",
  inputSchema,
  isReadOnly: true,

  async call(input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    const baseDir = path.resolve(input.path ?? process.cwd());

    try {
      const stat = fs.statSync(baseDir);
      if (!stat.isDirectory()) {
        return { content: `Error: ${baseDir} is not a directory`, is_error: true };
      }
    } catch {
      return { content: `Error: directory not found: ${baseDir}`, is_error: true };
    }

    try {
      const matches = fs.globSync(input.pattern, { cwd: baseDir });
      const sorted = matches.sort();
      const total = sorted.length;
      const truncated = sorted.slice(0, MAX_RESULTS);

      const lines = truncated.map((f) => path.join(baseDir, f));
      let output = `Found ${total} file(s) matching "${input.pattern}" in ${baseDir}`;
      if (total > MAX_RESULTS) {
        output += ` (showing first ${MAX_RESULTS})`;
      }
      output += "\n" + lines.join("\n");

      return { content: output };
    } catch (err) {
      return {
        content: `Error during glob: ${err instanceof Error ? err.message : String(err)}`,
        is_error: true,
      };
    }
  },
};
