import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Tool } from "../tool.ts";
import type { ToolResult } from "../types.ts";

const MAX_OUTPUT_BYTES = 100_000;
const DEFAULT_LIMIT = 2000;

const inputSchema = z.object({
  file_path: z.string().describe("Absolute path to the file to read"),
  offset: z.number().optional().describe("Line number to start from (0-indexed)"),
  limit: z.number().optional().describe("Maximum number of lines to return (default 2000)"),
});

function isBinary(buffer: Buffer): boolean {
  const check = buffer.subarray(0, 8192);
  for (let i = 0; i < check.length; i++) {
    if (check[i] === 0) return true;
  }
  return false;
}

export const readFileTool: Tool<typeof inputSchema.shape> = {
  name: "ReadFile",
  description: "Read a file from the filesystem with optional line offset and limit. Returns content with line numbers.",
  inputSchema,
  isReadOnly: true,

  async call(input: z.infer<typeof inputSchema>, _signal?: AbortSignal): Promise<ToolResult> {
    const filePath = path.resolve(input.file_path);

    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return { content: `Error: ${filePath} is a directory, not a file`, is_error: true };
      }

      const raw = fs.readFileSync(filePath);
      if (isBinary(raw)) {
        return { content: `Error: ${filePath} appears to be a binary file`, is_error: true };
      }

      const text = raw.toString("utf-8");
      const lines = text.split("\n");
      const offset = input.offset ?? 0;
      const limit = input.limit ?? DEFAULT_LIMIT;
      const slice = lines.slice(offset, offset + limit);

      let output = slice
        .map((line, i) => `${offset + i + 1}\t${line}`)
        .join("\n");

      if (output.length > MAX_OUTPUT_BYTES) {
        output = output.slice(0, MAX_OUTPUT_BYTES) + "\n... (truncated at 100KB)";
      }

      const totalLines = lines.length;
      const header = `File: ${filePath} (${totalLines} lines)`;
      const rangeNote = offset > 0 || slice.length < totalLines
        ? ` — showing lines ${offset + 1}–${offset + slice.length}`
        : "";

      return { content: `${header}${rangeNote}\n${output}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT")) {
        return { content: `File not found: ${filePath}`, is_error: true };
      }
      if (msg.includes("EACCES")) {
        return { content: `Permission denied: ${filePath}`, is_error: true };
      }
      return { content: `Error reading file: ${msg}`, is_error: true };
    }
  },
};
