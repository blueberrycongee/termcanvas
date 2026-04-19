import { create } from "zustand";

interface MemoryNode {
  fileName: string;
  filePath: string;
  name: string;
  description: string;
  type: string;
  body: string;
  mtime: number;
  ctime: number;
}

interface MemoryEdge {
  source: string;
  target: string;
  label: string;
}

interface MemoryGraph {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  dirPath: string;
}

/**
 * Cached per-node canvas position. Kept in the store (not in the
 * component) so positions survive unmount/remount — clicking into
 * the memory tab, out, and back in no longer scatters the nodes
 * around the canvas and restarts the force simulation. Keyed by
 * `${dirPath}::${fileName}` so different projects don't collide.
 */
export type NodePositionCache = Map<string, { x: number; y: number }>;

interface MemoryStore {
  graph: MemoryGraph;
  selectedNode: string | null;
  loading: boolean;
  nodePositions: NodePositionCache;
  setGraph: (graph: MemoryGraph) => void;
  setSelectedNode: (fileName: string | null) => void;
  setLoading: (loading: boolean) => void;
  mergeNodePositions: (entries: Iterable<[string, { x: number; y: number }]>) => void;
}

export function positionKey(dirPath: string, fileName: string): string {
  return `${dirPath}::${fileName}`;
}

export const useMemoryStore = create<MemoryStore>((set) => ({
  graph: { nodes: [], edges: [], dirPath: "" },
  selectedNode: null,
  loading: false,
  nodePositions: new Map(),
  setGraph: (graph) => set({ graph }),
  setSelectedNode: (selectedNode) => set({ selectedNode }),
  setLoading: (loading) => set({ loading }),
  mergeNodePositions: (entries) =>
    set((state) => {
      const next = new Map(state.nodePositions);
      for (const [key, pos] of entries) next.set(key, pos);
      return { nodePositions: next };
    }),
}));
