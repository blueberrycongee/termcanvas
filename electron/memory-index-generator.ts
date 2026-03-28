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
