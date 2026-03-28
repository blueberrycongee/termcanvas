# Memory Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Memory tab to TermCanvas's left panel that visualizes Claude Code's memory files as a graph, with click-to-edit support.

**Architecture:** Read-only integration with Claude Code's `~/.claude/projects/{project-id}/memory/` directory. Electron main process provides a memory-service that scans, parses, and watches the directory. Renderer displays a force-directed graph in a new left panel tab. Follows existing IPC/preload/store patterns exactly.

**Tech Stack:** TypeScript, Zustand, React, Electron IPC, fs.watch, YAML frontmatter parsing

---

### Task 1: Memory Service — Parse Memory Files

**Files:**
- Create: `electron/memory-service.ts`
- Test: `tests/memory-service.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/memory-service.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

test("parseMemoryFile extracts frontmatter and body", async () => {
  const { parseMemoryFile } = await import(
    `../electron/memory-service.ts?parse-${Date.now()}`
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-test-"));
  const filePath = path.join(tmpDir, "feedback_test.md");
  fs.writeFileSync(
    filePath,
    `---
name: test memory
description: a test memory file
type: feedback
---

This is the body content.

**Why:** testing
`,
  );

  const result = parseMemoryFile(filePath);
  assert.equal(result.name, "test memory");
  assert.equal(result.description, "a test memory file");
  assert.equal(result.type, "feedback");
  assert.ok(result.body.includes("This is the body content."));
  assert.equal(result.fileName, "feedback_test.md");
  assert.ok(result.mtime > 0);

  fs.rmSync(tmpDir, { recursive: true });
});

test("parseMemoryFile returns null for non-existent file", async () => {
  const { parseMemoryFile } = await import(
    `../electron/memory-service.ts?nofile-${Date.now()}`
  );
  const result = parseMemoryFile("/tmp/does-not-exist.md");
  assert.equal(result, null);
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/memory-service.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// electron/memory-service.ts
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
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/memory-service.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add electron/memory-service.ts tests/memory-service.test.ts
git commit -m "feat(memory): add parseMemoryFile for YAML frontmatter extraction"
```

---

### Task 2: Memory Service — Scan Directory and Extract Graph

**Files:**
- Modify: `electron/memory-service.ts`
- Modify: `tests/memory-service.test.ts`

**Step 1: Write the failing test**

```typescript
// append to tests/memory-service.test.ts

test("scanMemoryDir returns graph with nodes and edges from MEMORY.md", async () => {
  const { scanMemoryDir } = await import(
    `../electron/memory-service.ts?scan-${Date.now()}`
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-test-"));

  fs.writeFileSync(
    path.join(tmpDir, "MEMORY.md"),
    `- [Hydra watch](feedback_hydra_watch.md) — always poll after dispatch
- [Hydra approve](feedback_hydra_approve.md) — need --auto-approve
`,
  );

  fs.writeFileSync(
    path.join(tmpDir, "feedback_hydra_watch.md"),
    `---
name: hydra-auto-watch
description: After launching Hydra workflows, immediately enter watch polling loop
type: feedback
---

Watch after dispatch.
`,
  );

  fs.writeFileSync(
    path.join(tmpDir, "feedback_hydra_approve.md"),
    `---
name: Hydra must use --auto-approve
description: Spawned CLIs need --auto-approve
type: feedback
---

Always pass --auto-approve.
`,
  );

  const graph = scanMemoryDir(tmpDir);

  // Nodes: MEMORY.md + 2 memory files
  assert.equal(graph.nodes.length, 3);
  const memoryNode = graph.nodes.find((n) => n.fileName === "MEMORY.md");
  assert.ok(memoryNode);
  assert.equal(memoryNode.type, "index");

  // Edges: MEMORY.md -> each file
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.edges.every((e) => e.source === "MEMORY.md"));

  fs.rmSync(tmpDir, { recursive: true });
});

test("scanMemoryDir returns empty graph for non-existent dir", async () => {
  const { scanMemoryDir } = await import(
    `../electron/memory-service.ts?empty-${Date.now()}`
  );
  const graph = scanMemoryDir("/tmp/does-not-exist-dir");
  assert.equal(graph.nodes.length, 0);
  assert.equal(graph.edges.length, 0);
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/memory-service.test.ts`
Expected: FAIL — scanMemoryDir not found

**Step 3: Write minimal implementation**

```typescript
// append to electron/memory-service.ts

export interface MemoryNode {
  fileName: string;
  filePath: string;
  name: string;
  description: string;
  type: string; // "index" | "user" | "feedback" | "project" | "reference" | "unknown"
  body: string;
  mtime: number;
  ctime: number;
}

export interface MemoryEdge {
  source: string; // fileName
  target: string; // fileName
  label: string;  // link text from markdown
}

export interface MemoryGraph {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  dirPath: string;
}

export function scanMemoryDir(dirPath: string): MemoryGraph {
  const empty: MemoryGraph = { nodes: [], edges: [], dirPath };
  try {
    if (!fs.existsSync(dirPath)) return empty;
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".md"));

    const nodes: MemoryNode[] = [];
    const edges: MemoryEdge[] = [];

    for (const fileName of files) {
      const filePath = path.join(dirPath, fileName);
      if (fileName === "MEMORY.md") {
        const raw = fs.readFileSync(filePath, "utf-8");
        const stat = fs.statSync(filePath);
        nodes.push({
          fileName,
          filePath,
          name: "MEMORY",
          description: "Memory index",
          type: "index",
          body: raw,
          mtime: stat.mtimeMs,
          ctime: stat.birthtimeMs,
        });
        // Extract links: - [Title](file.md) — description
        const linkRe = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
        let match: RegExpExecArray | null;
        while ((match = linkRe.exec(raw)) !== null) {
          edges.push({
            source: "MEMORY.md",
            target: match[2],
            label: match[1],
          });
        }
      } else {
        const parsed = parseMemoryFile(filePath);
        if (parsed) nodes.push(parsed);
      }
    }

    return { nodes, edges, dirPath };
  } catch {
    return empty;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/memory-service.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add electron/memory-service.ts tests/memory-service.test.ts
git commit -m "feat(memory): add scanMemoryDir to build graph from memory directory"
```

---

### Task 3: Memory Service — Project ID Derivation + IPC Registration

**Files:**
- Modify: `electron/memory-service.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/index.ts`
- Test: `tests/memory-service.test.ts`

**Step 1: Write the failing test**

```typescript
// append to tests/memory-service.test.ts

test("getMemoryDirForWorktree derives correct Claude Code memory path", async () => {
  const { getMemoryDirForWorktree } = await import(
    `../electron/memory-service.ts?derive-${Date.now()}`
  );
  const result = getMemoryDirForWorktree("/Users/zzzz/termcanvas");
  assert.ok(result.endsWith("/-Users-zzzz-termcanvas/memory"));
  assert.ok(result.includes(".claude/projects"));
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/memory-service.test.ts`
Expected: FAIL

**Step 3: Implement getMemoryDirForWorktree + IPC handlers**

Add to `electron/memory-service.ts`:
```typescript
import os from "node:os";

export function getMemoryDirForWorktree(worktreePath: string): string {
  const homeDir = os.homedir();
  const projectId = worktreePath.replace(/\//g, "-");
  return path.join(homeDir, ".claude", "projects", projectId, "memory");
}
```

Add IPC handlers in `electron/main.ts` inside `setupIpc()`:
```typescript
// Memory service
ipcMain.handle("memory:scan", async (_event, worktreePath: string) => {
  const { getMemoryDirForWorktree, scanMemoryDir } = await import("./memory-service.js");
  const memDir = getMemoryDirForWorktree(worktreePath);
  return scanMemoryDir(memDir);
});

ipcMain.handle("memory:read-file", async (_event, filePath: string) => {
  const { parseMemoryFile } = await import("./memory-service.js");
  return parseMemoryFile(filePath);
});

ipcMain.handle("memory:write-file", async (_event, filePath: string, content: string) => {
  const fs = await import("node:fs");
  fs.writeFileSync(filePath, content, "utf-8");
});
```

Add to `electron/preload.ts` inside contextBridge:
```typescript
memory: {
  scan: (worktreePath: string) =>
    ipcRenderer.invoke("memory:scan", worktreePath),
  readFile: (filePath: string) =>
    ipcRenderer.invoke("memory:read-file", filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke("memory:write-file", filePath, content),
},
```

Add types in `src/types/index.ts` — add to TermCanvasAPI interface:
```typescript
memory: {
  scan: (worktreePath: string) => Promise<{
    nodes: Array<{
      fileName: string;
      filePath: string;
      name: string;
      description: string;
      type: string;
      body: string;
      mtime: number;
      ctime: number;
    }>;
    edges: Array<{
      source: string;
      target: string;
      label: string;
    }>;
    dirPath: string;
  }>;
  readFile: (filePath: string) => Promise<{
    fileName: string;
    filePath: string;
    name: string;
    description: string;
    type: string;
    body: string;
    mtime: number;
    ctime: number;
  } | null>;
  writeFile: (filePath: string, content: string) => Promise<void>;
};
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/memory-service.test.ts`
Expected: PASS

**Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add electron/memory-service.ts electron/main.ts electron/preload.ts src/types/index.ts tests/memory-service.test.ts
git commit -m "feat(memory): add IPC bridge for memory scanning and file operations"
```

---

### Task 4: Memory Store (Zustand)

**Files:**
- Create: `src/stores/memoryStore.ts`
- Test: `tests/memory-store.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/memory-store.test.ts
import test from "node:test";
import assert from "node:assert/strict";

test("memoryStore initial state is empty graph", async () => {
  const { useMemoryStore } = await import(
    `../src/stores/memoryStore.ts?init-${Date.now()}`
  );
  const state = useMemoryStore.getState();
  assert.deepEqual(state.graph, { nodes: [], edges: [], dirPath: "" });
  assert.equal(state.selectedNode, null);
  assert.equal(state.loading, false);
});

test("memoryStore setGraph updates graph state", async () => {
  const { useMemoryStore } = await import(
    `../src/stores/memoryStore.ts?set-${Date.now()}`
  );
  const mockGraph = {
    nodes: [
      {
        fileName: "MEMORY.md",
        filePath: "/tmp/MEMORY.md",
        name: "MEMORY",
        description: "index",
        type: "index",
        body: "",
        mtime: 1000,
        ctime: 900,
      },
    ],
    edges: [],
    dirPath: "/tmp",
  };
  useMemoryStore.getState().setGraph(mockGraph);
  assert.equal(useMemoryStore.getState().graph.nodes.length, 1);
});

test("memoryStore setSelectedNode updates selection", async () => {
  const { useMemoryStore } = await import(
    `../src/stores/memoryStore.ts?select-${Date.now()}`
  );
  useMemoryStore.getState().setSelectedNode("feedback_test.md");
  assert.equal(useMemoryStore.getState().selectedNode, "feedback_test.md");

  useMemoryStore.getState().setSelectedNode(null);
  assert.equal(useMemoryStore.getState().selectedNode, null);
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/memory-store.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/stores/memoryStore.ts
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
  selectedNode: string | null; // fileName
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
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/memory-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/memoryStore.ts tests/memory-store.test.ts
git commit -m "feat(memory): add Zustand memoryStore for graph state"
```

---

### Task 5: Add Memory Tab to LeftPanel

**Files:**
- Modify: `src/stores/canvasStore.ts` (line 6)
- Modify: `src/components/LeftPanel.tsx` (lines 56-60, 315-324)
- Create: `src/components/LeftPanel/MemoryContent.tsx`

**Step 1: Update LeftPanelTab type**

In `src/stores/canvasStore.ts` line 6, change:
```typescript
// before
export type LeftPanelTab = "files" | "diff" | "preview" | "git";
// after
export type LeftPanelTab = "files" | "diff" | "preview" | "git" | "memory";
```

**Step 2: Create MemoryContent stub component**

```typescript
// src/components/LeftPanel/MemoryContent.tsx
import { useEffect } from "react";
import { useMemoryStore } from "../../stores/memoryStore";

interface Props {
  worktreePath: string | null;
}

export function MemoryContent({ worktreePath }: Props) {
  const { graph, selectedNode, loading, setGraph, setSelectedNode, setLoading } =
    useMemoryStore();

  useEffect(() => {
    if (!worktreePath) return;
    let cancelled = false;
    setLoading(true);
    window.termcanvas.memory.scan(worktreePath).then((result) => {
      if (!cancelled) {
        setGraph(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [worktreePath, setGraph, setLoading]);

  if (!worktreePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs">
        No worktree selected
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs">
        Loading memories...
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs px-4 text-center">
        No memory files found.
        <br />
        Claude Code stores memories in ~/.claude/projects/
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Graph area */}
      <div className="flex-1 min-h-0 relative">
        {graph.nodes.map((node) => (
          <button
            key={node.fileName}
            onClick={() => setSelectedNode(node.fileName)}
            className={`block w-full text-left px-3 py-2 text-xs border-b border-zinc-800 hover:bg-zinc-800/50 ${
              selectedNode === node.fileName ? "bg-zinc-800" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  node.type === "index"
                    ? "bg-white"
                    : node.type === "user"
                      ? "bg-blue-400"
                      : node.type === "feedback"
                        ? "bg-green-400"
                        : node.type === "project"
                          ? "bg-orange-400"
                          : node.type === "reference"
                            ? "bg-purple-400"
                            : "bg-zinc-400"
                }`}
              />
              <span className="truncate text-zinc-200">{node.name}</span>
            </div>
            {node.description && (
              <div className="text-zinc-500 truncate mt-0.5 ml-4">
                {node.description}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Editor area */}
      {selectedNode && (
        <MemoryEditor
          node={graph.nodes.find((n) => n.fileName === selectedNode) ?? null}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}

function MemoryEditor({
  node,
  onClose,
}: {
  node: {
    fileName: string;
    filePath: string;
    name: string;
    type: string;
    body: string;
  } | null;
  onClose: () => void;
}) {
  if (!node) return null;

  return (
    <div className="border-t border-zinc-700 flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-zinc-400 border-b border-zinc-800">
        <span className="truncate">{node.fileName}</span>
        <button onClick={onClose} className="hover:text-zinc-200 ml-2">
          ✕
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3 text-xs text-zinc-300 whitespace-pre-wrap">
        {node.body}
      </div>
    </div>
  );
}
```

**Step 3: Add Memory tab to LeftPanel.tsx**

Add icon import (top of file, alongside existing icon imports — find the icon import pattern and add one for memory, e.g. use an existing icon or a simple SVG):

In TAB_CONFIG array (line 56-60), add:
```typescript
{ id: "memory" as LeftPanelTab, icon: IconFiles, labelKey: "left_panel_memory" as const },
```

Note: Reuse `IconFiles` or another existing icon initially; update later. The `labelKey` will need an i18n entry — for MVP, can use a fallback.

In the content rendering section (around lines 315-324), add before the closing:
```typescript
{activeTab === "memory" && (
  <MemoryContent worktreePath={effectiveWorktreePath} />
)}
```

Add import at top:
```typescript
import { MemoryContent } from "./LeftPanel/MemoryContent";
```

**Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: May need i18n key — add `"left_panel_memory": "Memory"` to en.json and zh.json

**Step 5: Add i18n keys**

In `src/i18n/en.json`, add: `"left_panel_memory": "Memory"`
In `src/i18n/zh.json`, add: `"left_panel_memory": "记忆"`

**Step 6: Type check again**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/stores/canvasStore.ts src/components/LeftPanel.tsx src/components/LeftPanel/MemoryContent.tsx src/i18n/en.json src/i18n/zh.json
git commit -m "feat(memory): add Memory tab to left panel with list view and editor"
```

---

### Task 6: Force-Directed Graph Visualization

**Files:**
- Modify: `src/components/LeftPanel/MemoryContent.tsx`

This replaces the list view with a canvas-based force-directed graph. Use a simple force simulation with `requestAnimationFrame` — no external library needed for this scale (typically < 20 nodes).

**Step 1: Replace graph area in MemoryContent**

Replace the `{graph.nodes.map(...)}` section in MemoryContent.tsx with a `<MemoryGraph>` component:

```typescript
// Add to src/components/LeftPanel/MemoryContent.tsx

import { useRef, useEffect, useCallback, useState } from "react";

interface GraphNode {
  fileName: string;
  name: string;
  type: string;
  description: string;
  mtime: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function MemoryGraph({
  graph,
  selectedNode,
  onSelectNode,
}: {
  graph: { nodes: Array<{ fileName: string; name: string; type: string; description: string; mtime: number }>; edges: Array<{ source: string; target: string }> };
  selectedNode: string | null;
  onSelectNode: (fileName: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  // Initialize node positions
  useEffect(() => {
    const cx = 150;
    const cy = 150;
    nodesRef.current = graph.nodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / graph.nodes.length;
      const r = n.type === "index" ? 0 : 80;
      return {
        ...n,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });
  }, [graph.nodes]);

  // Color mapping
  const typeColor = useCallback((type: string) => {
    switch (type) {
      case "index": return "#ffffff";
      case "user": return "#60a5fa";
      case "feedback": return "#4ade80";
      case "project": return "#fb923c";
      case "reference": return "#c084fc";
      default: return "#71717a";
    }
  }, []);

  // Opacity based on mtime freshness
  const nodeOpacity = useCallback((mtime: number) => {
    const age = Date.now() - mtime;
    const dayMs = 86400000;
    if (age < dayMs) return 1.0;
    if (age < 7 * dayMs) return 0.85;
    if (age < 30 * dayMs) return 0.7;
    return 0.5;
  }, []);

  // Force simulation + render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const edgeMap = graph.edges.map((e) => ({
      source: nodesRef.current.find((n) => n.fileName === e.source),
      target: nodesRef.current.find((n) => n.fileName === e.target),
    }));

    let running = true;
    const tick = () => {
      if (!running) return;
      const nodes = nodesRef.current;
      const w = canvas.width;
      const h = canvas.height;

      // Simple force: repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 500 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodes[i].vx -= fx;
          nodes[i].vy -= fy;
          nodes[j].vx += fx;
          nodes[j].vy += fy;
        }
      }

      // Attraction along edges
      for (const edge of edgeMap) {
        if (!edge.source || !edge.target) continue;
        const dx = edge.target.x - edge.source.x;
        const dy = edge.target.y - edge.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = (dist - 100) * 0.01;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        edge.source.vx += fx;
        edge.source.vy += fy;
        edge.target.vx -= fx;
        edge.target.vy -= fy;
      }

      // Center gravity
      const cx = w / 2;
      const cy = h / 2;
      for (const node of nodes) {
        node.vx += (cx - node.x) * 0.005;
        node.vy += (cy - node.y) * 0.005;
        node.vx *= 0.9; // damping
        node.vy *= 0.9;
        node.x += node.vx;
        node.y += node.vy;
      }

      // Draw
      ctx.clearRect(0, 0, w, h);

      // Edges
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      for (const edge of edgeMap) {
        if (!edge.source || !edge.target) continue;
        ctx.beginPath();
        ctx.moveTo(edge.source.x, edge.source.y);
        ctx.lineTo(edge.target.x, edge.target.y);
        ctx.stroke();
      }

      // Nodes
      for (const node of nodes) {
        const r = node.type === "index" ? 8 : 6;
        const color = typeColor(node.type);
        const alpha = nodeOpacity(node.mtime);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = selectedNode === node.fileName ? "#fff" : color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Label
        ctx.fillStyle = "#aaa";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(node.name, node.x, node.y + r + 12);
        ctx.globalAlpha = 1;
      }

      animRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [graph, selectedNode, typeColor, nodeOpacity]);

  // Resize canvas
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    });
    ro.observe(container);
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    return () => ro.disconnect();
  }, []);

  // Click detection
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = nodesRef.current.find((n) => {
        const dx = n.x - x;
        const dy = n.y - y;
        return dx * dx + dy * dy < 144; // radius 12
      });
      onSelectNode(hit?.fileName ?? null);
    },
    [onSelectNode],
  );

  return (
    <div ref={containerRef} className="flex-1 min-h-0 relative">
      <canvas ref={canvasRef} onClick={handleClick} className="w-full h-full" />
    </div>
  );
}
```

Update the main MemoryContent return to use `<MemoryGraph>` instead of the button list:

```typescript
return (
  <div className="flex-1 flex flex-col min-h-0">
    <MemoryGraph
      graph={graph}
      selectedNode={selectedNode}
      onSelectNode={setSelectedNode}
    />
    {selectedNode && (
      <MemoryEditor
        node={graph.nodes.find((n) => n.fileName === selectedNode) ?? null}
        onClose={() => setSelectedNode(null)}
      />
    )}
  </div>
);
```

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Manual test**

Run the app, select a worktree with memory files, click Memory tab. Verify:
- Graph renders with MEMORY.md in center
- Edges connect to memory file nodes
- Colors match types
- Click selects node, shows editor below

**Step 4: Commit**

```bash
git add src/components/LeftPanel/MemoryContent.tsx
git commit -m "feat(memory): add force-directed graph visualization for memory nodes"
```

---

### Task 7: File Watching for Live Updates

**Files:**
- Modify: `electron/memory-service.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/index.ts`
- Modify: `src/components/LeftPanel/MemoryContent.tsx`

**Step 1: Add watch/unwatch to memory-service.ts**

```typescript
// append to electron/memory-service.ts
import type { FSWatcher } from "node:fs";

const watchers = new Map<string, FSWatcher>();

export function watchMemoryDir(
  dirPath: string,
  onChange: () => void,
): void {
  unwatchMemoryDir(dirPath);
  if (!fs.existsSync(dirPath)) return;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const watcher = fs.watch(dirPath, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 500); // debounce 500ms
  });
  watchers.set(dirPath, watcher);
}

export function unwatchMemoryDir(dirPath: string): void {
  const existing = watchers.get(dirPath);
  if (existing) {
    existing.close();
    watchers.delete(dirPath);
  }
}
```

**Step 2: Add IPC handlers for watch/unwatch in main.ts**

```typescript
ipcMain.handle("memory:watch", async (_event, worktreePath: string) => {
  const { getMemoryDirForWorktree, watchMemoryDir, scanMemoryDir } =
    await import("./memory-service.js");
  const memDir = getMemoryDirForWorktree(worktreePath);
  watchMemoryDir(memDir, () => {
    const graph = scanMemoryDir(memDir);
    sendToWindow(mainWindow!, "memory:changed", graph);
  });
});

ipcMain.handle("memory:unwatch", async (_event, worktreePath: string) => {
  const { getMemoryDirForWorktree, unwatchMemoryDir } =
    await import("./memory-service.js");
  const memDir = getMemoryDirForWorktree(worktreePath);
  unwatchMemoryDir(memDir);
});
```

**Step 3: Add preload bridge**

In `electron/preload.ts`, add to memory section:
```typescript
watch: (worktreePath: string) =>
  ipcRenderer.invoke("memory:watch", worktreePath),
unwatch: (worktreePath: string) =>
  ipcRenderer.invoke("memory:unwatch", worktreePath),
onChanged: (callback: (graph: unknown) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, graph: unknown) =>
    callback(graph);
  ipcRenderer.on("memory:changed", listener);
  return () => ipcRenderer.removeListener("memory:changed", listener);
},
```

**Step 4: Update types in src/types/index.ts**

Add to memory interface:
```typescript
watch: (worktreePath: string) => Promise<void>;
unwatch: (worktreePath: string) => Promise<void>;
onChanged: (callback: (graph: { nodes: Array<{...}>; edges: Array<{...}>; dirPath: string }) => void) => () => void;
```

**Step 5: Hook up in MemoryContent.tsx**

Add to the useEffect in MemoryContent:
```typescript
useEffect(() => {
  if (!worktreePath) return;
  let cancelled = false;

  setLoading(true);
  window.termcanvas.memory.scan(worktreePath).then((result) => {
    if (!cancelled) {
      setGraph(result);
      setLoading(false);
    }
  });

  window.termcanvas.memory.watch(worktreePath);
  const unsubscribe = window.termcanvas.memory.onChanged((graph) => {
    if (!cancelled) setGraph(graph as typeof graph);
  });

  return () => {
    cancelled = true;
    window.termcanvas.memory.unwatch(worktreePath);
    unsubscribe();
  };
}, [worktreePath, setGraph, setLoading]);
```

**Step 6: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add electron/memory-service.ts electron/main.ts electron/preload.ts src/types/index.ts src/components/LeftPanel/MemoryContent.tsx
git commit -m "feat(memory): add fs.watch for live memory graph updates"
```

---

### Task 8: Edit Support

**Files:**
- Modify: `src/components/LeftPanel/MemoryContent.tsx`

**Step 1: Make MemoryEditor editable**

Replace the MemoryEditor component with an editable version:

```typescript
function MemoryEditor({
  node,
  onClose,
}: {
  node: {
    fileName: string;
    filePath: string;
    name: string;
    type: string;
    body: string;
  } | null;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (node) {
      // Reconstruct full file content from frontmatter + body
      window.termcanvas.memory.readFile(node.filePath).then((result) => {
        if (result) {
          const raw = `---\nname: ${result.name}\ndescription: ${result.description}\ntype: ${result.type}\n---\n\n${result.body}`;
          setContent(raw);
        }
      });
    }
  }, [node?.filePath]);

  if (!node) return null;

  const handleSave = async () => {
    setSaving(true);
    await window.termcanvas.memory.writeFile(node.filePath, content);
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className="border-t border-zinc-700 flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-zinc-400 border-b border-zinc-800">
        <span className="truncate">{node.fileName}</span>
        <div className="flex gap-2 ml-2">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-green-400 hover:text-green-300"
              >
                {saving ? "..." : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="hover:text-zinc-200"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="hover:text-zinc-200"
            >
              Edit
            </button>
          )}
          <button onClick={onClose} className="hover:text-zinc-200">
            ✕
          </button>
        </div>
      </div>
      {editing ? (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="flex-1 min-h-0 p-3 text-xs text-zinc-300 bg-transparent resize-none outline-none font-mono"
          spellCheck={false}
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-auto p-3 text-xs text-zinc-300 whitespace-pre-wrap">
          {node.body}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add useState import if not already present**

Ensure `useState` is in the React import.

**Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Manual test**

- Click a memory node → editor shows below
- Click "Edit" → textarea appears with full file content
- Modify content → click "Save" → file saved
- fs.watch triggers → graph re-renders with updated mtime

**Step 5: Commit**

```bash
git add src/components/LeftPanel/MemoryContent.tsx
git commit -m "feat(memory): add inline edit support for memory files"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | memory-service.ts, test | Parse YAML frontmatter from memory files |
| 2 | memory-service.ts, test | Scan directory, build graph with nodes + edges |
| 3 | memory-service.ts, main.ts, preload.ts, types | IPC bridge + project ID derivation |
| 4 | memoryStore.ts, test | Zustand store for graph state |
| 5 | canvasStore.ts, LeftPanel.tsx, MemoryContent.tsx, i18n | Memory tab in left panel |
| 6 | MemoryContent.tsx | Force-directed graph visualization |
| 7 | memory-service.ts, main.ts, preload.ts, types, MemoryContent.tsx | Live fs.watch updates |
| 8 | MemoryContent.tsx | Inline edit + save |
