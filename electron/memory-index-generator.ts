export interface MemoryNodeLike {
  fileName: string;
  type: string;
  body: string;
}

export interface Reference {
  from: string;
  to: string;
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
