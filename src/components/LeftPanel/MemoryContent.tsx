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
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs px-4 text-center leading-relaxed">
        No memory files found.
        <br />
        Claude Code stores memories in ~/.claude/projects/
      </div>
    );
  }

  const selected = graph.nodes.find((n) => n.fileName === selectedNode);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Node list */}
      <div className="flex-1 min-h-0 overflow-auto">
        {graph.nodes.map((node) => (
          <button
            key={node.fileName}
            onClick={() =>
              setSelectedNode(
                selectedNode === node.fileName ? null : node.fileName,
              )
            }
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
            {node.description && node.type !== "index" && (
              <div className="text-zinc-500 truncate mt-0.5 ml-4">
                {node.description}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Editor */}
      {selected && (
        <div className="border-t border-zinc-700 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-zinc-400 border-b border-zinc-800">
            <span className="truncate">{selected.fileName}</span>
            <button
              onClick={() => setSelectedNode(null)}
              className="hover:text-zinc-200 ml-2 flex-shrink-0"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-3 text-xs text-zinc-300 whitespace-pre-wrap font-mono">
            {selected.body}
          </div>
        </div>
      )}
    </div>
  );
}
