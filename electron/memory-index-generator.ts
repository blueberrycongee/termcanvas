import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface MemoryNodeLike {
  fileName: string;
  type: string;
  body: string;
}

export interface Reference {
  from: string;
  to: string;
}

export interface TimeSensitiveEntry {
  fileName: string;
  date: string;
  daysAgo: number;
}

export function findTimeSensitiveMemories(
  nodes: MemoryNodeLike[],
  thresholdDays = 14,
): TimeSensitiveEntry[] {
  const dateRe = /\b(20\d{2}-\d{2}-\d{2})\b/g;
  const results: TimeSensitiveEntry[] = [];
  const now = Date.now();

  for (const node of nodes) {
    if (node.type === "index") continue;
    dateRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = dateRe.exec(node.body)) !== null) {
      const dateMs = new Date(match[1]).getTime();
      const daysAgo = Math.floor((now - dateMs) / 86400000);
      if (daysAgo > thresholdDays) {
        results.push({ fileName: node.fileName, date: match[1], daysAgo });
        break;
      }
    }
  }
  return results;
}

export function generateEnhancedIndex(nodes: MemoryNodeLike[]): string {
  if (nodes.length === 0) return "";

  const references = findExplicitReferences(nodes);
  const timeSensitive = findTimeSensitiveMemories(nodes);

  if (references.length === 0 && timeSensitive.length === 0) return "";

  let output = '<memory-graph source="termcanvas">\n\n';

  if (references.length > 0) {
    output += "## References\n";
    for (const ref of references) {
      output += `- ${ref.from} \u2192 ${ref.to}\n`;
    }
    output += "\n";
  }

  if (timeSensitive.length > 0) {
    output += "## Time-sensitive\n";
    for (const ts of timeSensitive) {
      output += `- ${ts.fileName} \u2014 mentions date ${ts.date} (>${ts.daysAgo}d ago)\n`;
    }
    output += "\n";
  }

  output += "</memory-graph>";
  return output;
}

export class MemoryIndexCache {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  update(content: string): boolean {
    const hashFile = path.join(this.dir, "memory-index.hash");
    const indexFile = path.join(this.dir, "memory-index.md");

    const newHash = crypto.createHash("md5").update(content).digest("hex");

    try {
      const oldHash = fs.readFileSync(hashFile, "utf-8").trim();
      if (oldHash === newHash) return false;
    } catch {}

    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    fs.writeFileSync(indexFile, content, "utf-8");
    fs.writeFileSync(hashFile, newHash, "utf-8");
    return true;
  }

  read(): string {
    try {
      return fs.readFileSync(path.join(this.dir, "memory-index.md"), "utf-8");
    } catch {
      return "";
    }
  }
}

export function findExplicitReferences(nodes: MemoryNodeLike[]): Reference[] {
  const linkRe = /\[([^\]]*)\]\(([^)]+\.md)\)/g;
  const nodeFileNames = new Set(nodes.map((n) => n.fileName));
  const results: Reference[] = [];

  for (const node of nodes) {
    if (node.type === "index") continue;
    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(node.body)) !== null) {
      const target = match[2];
      if (nodeFileNames.has(target) && target !== node.fileName) {
        results.push({ from: node.fileName, to: target });
      }
    }
  }
  return results;
}
