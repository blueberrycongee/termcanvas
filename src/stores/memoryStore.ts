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

interface MemoryStore {
  graph: MemoryGraph;
  selectedNode: string | null;
  loading: boolean;
  setGraph: (graph: MemoryGraph) => void;
  setSelectedNode: (fileName: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useMemoryStore = create<MemoryStore>((set) => ({
  graph: { nodes: [], edges: [], dirPath: "" },
  selectedNode: null,
  loading: false,
  setGraph: (graph) => set({ graph }),
  setSelectedNode: (selectedNode) => set({ selectedNode }),
  setLoading: (loading) => set({ loading }),
}));
