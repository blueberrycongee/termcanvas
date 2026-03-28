import fs from "node:fs";
import path from "node:path";

export interface MemoryFile {
  fileName: string;
  filePath: string;
  name: string;
  description: string;
  type: string;
  body: string;
  mtime: number;
  ctime: number;
}

export function parseMemoryFile(filePath: string): MemoryFile | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);

    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!fmMatch) {
      return {
        fileName,
        filePath,
        name: fileName.replace(/\.md$/, ""),
        description: "",
        type: "unknown",
        body: raw,
        mtime: stat.mtimeMs,
        ctime: stat.birthtimeMs,
      };
    }

    const frontmatter = fmMatch[1];
    const body = fmMatch[2].trim();

    const get = (key: string): string => {
      const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      return m ? m[1].trim() : "";
    };

    return {
      fileName,
      filePath,
      name: get("name"),
      description: get("description"),
      type: get("type"),
      body,
      mtime: stat.mtimeMs,
      ctime: stat.birthtimeMs,
    };
  } catch {
    return null;
  }
}
