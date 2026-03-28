import { useEffect, useRef, useCallback } from "react";
import { useMemoryStore } from "../../stores/memoryStore";

interface GraphNodePos {
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
  graph: {
    nodes: Array<{
      fileName: string;
      name: string;
      type: string;
      description: string;
      mtime: number;
    }>;
    edges: Array<{ source: string; target: string }>;
  };
  selectedNode: string | null;
  onSelectNode: (fileName: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<GraphNodePos[]>([]);
  const animRef = useRef<number>(0);

  // Initialize positions: index node at center, others in a circle
  useEffect(() => {
    const w = containerRef.current?.clientWidth ?? 300;
    const h = containerRef.current?.clientHeight ?? 300;
    const cx = w / 2;
    const cy = h / 2;

    const nonIndex = graph.nodes.filter((n) => n.type !== "index");

    nodesRef.current = graph.nodes.map((n) => {
      if (n.type === "index") {
        return { ...n, x: cx, y: cy, vx: 0, vy: 0 };
      }
      const i = nonIndex.indexOf(n);
      const angle = (2 * Math.PI * i) / Math.max(nonIndex.length, 1);
      const r = Math.min(w, h) * 0.3;
      return {
        ...n,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });
  }, [graph.nodes]);

  const typeColor = useCallback((type: string): string => {
    switch (type) {
      case "index":
        return "#ffffff";
      case "user":
        return "#60a5fa";
      case "feedback":
        return "#4ade80";
      case "project":
        return "#fb923c";
      case "reference":
        return "#c084fc";
      default:
        return "#71717a";
    }
  }, []);

  // Opacity: more recent = brighter
  const nodeOpacity = useCallback((mtime: number): number => {
    const ageMs = Date.now() - mtime;
    const dayMs = 86400000;
    if (ageMs < dayMs) return 1.0;
    if (ageMs < 7 * dayMs) return 0.85;
    if (ageMs < 30 * dayMs) return 0.7;
    return 0.5;
  }, []);

  // Force simulation + render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const edgeRefs = graph.edges.map((e) => ({
      source: nodesRef.current.find((n) => n.fileName === e.source),
      target: nodesRef.current.find((n) => n.fileName === e.target),
    }));

    let running = true;
    let frame = 0;

    const tick = () => {
      if (!running) return;
      const nodes = nodesRef.current;
      if (nodes.length === 0) return;

      const w = canvas.width;
      const h = canvas.height;
      const dpr = window.devicePixelRatio || 1;
      const logicalW = w / dpr;
      const logicalH = h / dpr;
      const cx = logicalW / 2;
      const cy = logicalH / 2;

      // Only simulate for first ~200 frames, then just redraw
      if (frame < 200) {
        // Repulsion between all pairs
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const force = 800 / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            nodes[i].vx -= fx;
            nodes[i].vy -= fy;
            nodes[j].vx += fx;
            nodes[j].vy += fy;
          }
        }

        // Attraction along edges (spring)
        for (const edge of edgeRefs) {
          if (!edge.source || !edge.target) continue;
          const dx = edge.target.x - edge.source.x;
          const dy = edge.target.y - edge.source.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = (dist - 120) * 0.008;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          edge.source.vx += fx;
          edge.source.vy += fy;
          edge.target.vx -= fx;
          edge.target.vy -= fy;
        }

        // Center gravity
        for (const node of nodes) {
          node.vx += (cx - node.x) * 0.003;
          node.vy += (cy - node.y) * 0.003;
          node.vx *= 0.85; // damping
          node.vy *= 0.85;
          node.x += node.vx;
          node.y += node.vy;
          // Clamp to canvas
          node.x = Math.max(20, Math.min(logicalW - 20, node.x));
          node.y = Math.max(20, Math.min(logicalH - 20, node.y));
        }
      }

      // Draw
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, logicalW, logicalH);

      // Edges
      for (const edge of edgeRefs) {
        if (!edge.source || !edge.target) continue;
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(edge.source.x, edge.source.y);
        ctx.lineTo(edge.target.x, edge.target.y);
        ctx.stroke();
      }

      // Nodes
      for (const node of nodes) {
        const r = node.type === "index" ? 10 : 7;
        const color = typeColor(node.type);
        const alpha = nodeOpacity(node.mtime);
        const isSelected = selectedNode === node.fileName;

        ctx.globalAlpha = isSelected ? 1 : alpha;
        ctx.fillStyle = isSelected ? "#fff" : color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();

        if (isSelected) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Label
        ctx.globalAlpha = isSelected ? 1 : alpha * 0.8;
        ctx.fillStyle = isSelected ? "#e4e4e7" : "#a1a1aa";
        ctx.font = "10px ui-monospace, monospace";
        ctx.textAlign = "center";
        const label =
          node.name.length > 20 ? node.name.slice(0, 18) + "\u2026" : node.name;
        ctx.fillText(label, node.x, node.y + r + 14);
        ctx.globalAlpha = 1;
      }

      ctx.restore();

      frame++;
      animRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [graph, selectedNode, typeColor, nodeOpacity]);

  // Resize canvas to container
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const update = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width = container.clientWidth + "px";
      canvas.style.height = container.clientHeight + "px";
    };
    const ro = new ResizeObserver(update);
    ro.observe(container);
    update();
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
        return dx * dx + dy * dy < 225; // ~15px radius
      });
      onSelectNode(
        hit ? (hit.fileName === selectedNode ? null : hit.fileName) : null,
      );
    },
    [onSelectNode, selectedNode],
  );

  return (
    <div ref={containerRef} className="flex-1 min-h-0 relative bg-zinc-950">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="absolute inset-0 cursor-pointer"
      />
      {graph.nodes.length > 0 && (
        <div className="absolute bottom-2 left-2 flex gap-2 text-[9px] text-zinc-600">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
            user
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
            feedback
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" />
            project
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 inline-block" />
            reference
          </span>
        </div>
      )}
    </div>
  );
}

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
      <MemoryGraph
        graph={graph}
        selectedNode={selectedNode}
        onSelectNode={setSelectedNode}
      />

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
