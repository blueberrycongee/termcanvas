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
