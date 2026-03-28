import { useEffect, useRef, useCallback, useState } from "react";
import { useMemoryStore } from "../../stores/memoryStore";

// ─── Theme-aware colors ───────────────────────────────────────────────

function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

const TYPE_COLORS: Record<string, { dark: string; light: string }> = {
  index: { dark: "#e4e2df", light: "#1c1917" },
  user: { dark: "#5b9ef5", light: "#2563eb" },
  feedback: { dark: "#6cc4b0", light: "#0d9488" },
  project: { dark: "#d4a24e", light: "#d97706" },
  reference: { dark: "#9b7ad8", light: "#7c3aed" },
  unknown: { dark: "#7a7773", light: "#6b6660" },
};

function getTypeColor(type: string): string {
  const scheme = document.documentElement.getAttribute("data-theme");
  const mode = scheme === "light" ? "light" : "dark";
  return (TYPE_COLORS[type] ?? TYPE_COLORS.unknown)[mode];
}

// ─── Graph Node with position + emphasis ──────────────────────────────

interface GraphNodePos {
  fileName: string;
  filePath: string;
  name: string;
  type: string;
  description: string;
  mtime: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  emphasis: number; // 0..1 animated
}

// ─── MemoryGraph ──────────────────────────────────────────────────────

function MemoryGraph({
  graph,
  selectedNode,
  onSelectNode,
  onOpenFile,
}: {
  graph: {
    nodes: Array<{
      fileName: string;
      filePath: string;
      name: string;
      type: string;
      description: string;
      mtime: number;
    }>;
    edges: Array<{ source: string; target: string }>;
  };
  selectedNode: string | null;
  onSelectNode: (fileName: string | null) => void;
  onOpenFile: (filePath: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<GraphNodePos[]>([]);
  const animRef = useRef<number>(0);
  const needsResizeRef = useRef(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Build neighbor lookup
  const neighborsOf = useCallback(
    (fileName: string): Set<string> => {
      const s = new Set<string>();
      for (const e of graph.edges) {
        if (e.source === fileName) s.add(e.target);
        if (e.target === fileName) s.add(e.source);
      }
      return s;
    },
    [graph.edges],
  );

  // Initialize positions
  useEffect(() => {
    const w = containerRef.current?.clientWidth ?? 300;
    const h = containerRef.current?.clientHeight ?? 300;
    const cx = w / 2;
    const cy = h / 2;
    const nonIndex = graph.nodes.filter((n) => n.type !== "index");

    nodesRef.current = graph.nodes.map((n) => {
      if (n.type === "index") {
        return { ...n, x: cx, y: cy, vx: 0, vy: 0, emphasis: 0 };
      }
      const i = nonIndex.indexOf(n);
      const angle = (2 * Math.PI * i) / Math.max(nonIndex.length, 1);
      const r = Math.min(w, h) * 0.28;
      return {
        ...n,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        vx: 0,
        vy: 0,
        emphasis: 0,
      };
    });
  }, [graph.nodes]);

  // Mtime freshness → base opacity
  const nodeBaseAlpha = useCallback((mtime: number): number => {
    const ageMs = Date.now() - mtime;
    const dayMs = 86400000;
    if (ageMs < dayMs) return 1.0;
    if (ageMs < 7 * dayMs) return 0.88;
    if (ageMs < 30 * dayMs) return 0.72;
    return 0.55;
  }, []);

  // Node radius: logarithmic based on connections
  const nodeRadius = useCallback(
    (node: { fileName: string; type: string }): number => {
      const conns = graph.edges.filter(
        (e) => e.source === node.fileName || e.target === node.fileName,
      ).length;
      const base = node.type === "index" ? 11 : 6;
      return Math.min(base + Math.log(conns + 1) * 3, node.type === "index" ? 18 : 14);
    },
    [graph.edges],
  );

  // Main render loop
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
    const focusNode = hoveredNode ?? selectedNode;
    const focusNeighbors = focusNode ? neighborsOf(focusNode) : new Set<string>();

    const tick = () => {
      if (!running) return;
      const nodes = nodesRef.current;
      if (nodes.length === 0) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      // Apply pending resize inside the render loop (avoids blank frame)
      if (needsResizeRef.current) {
        needsResizeRef.current = false;
        const container = containerRef.current;
        if (container) {
          const d = window.devicePixelRatio || 1;
          canvas.width = container.clientWidth * d;
          canvas.height = container.clientHeight * d;
          canvas.style.width = container.clientWidth + "px";
          canvas.style.height = container.clientHeight + "px";
        }
      }

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cx = w / 2;
      const cy = h / 2;

      // ── Physics (first 300 frames) ──
      if (frame < 300) {
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const force = 1200 / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            nodes[i].vx -= fx;
            nodes[i].vy -= fy;
            nodes[j].vx += fx;
            nodes[j].vy += fy;
          }
        }
        for (const edge of edgeRefs) {
          if (!edge.source || !edge.target) continue;
          const dx = edge.target.x - edge.source.x;
          const dy = edge.target.y - edge.source.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = (dist - 100) * 0.01;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          edge.source.vx += fx;
          edge.source.vy += fy;
          edge.target.vx -= fx;
          edge.target.vy -= fy;
        }
        for (const node of nodes) {
          node.vx += (cx - node.x) * 0.004;
          node.vy += (cy - node.y) * 0.004;
          node.vx *= 0.86;
          node.vy *= 0.86;
          node.x += node.vx;
          node.y += node.vy;
          node.x = Math.max(24, Math.min(w - 24, node.x));
          node.y = Math.max(24, Math.min(h - 24, node.y));
        }
      }

      // ── Emphasis animation (smooth easing) ──
      for (const node of nodes) {
        const isFocused =
          node.fileName === hoveredNode || node.fileName === selectedNode;
        const isNeighbor = focusNeighbors.has(node.fileName);
        const target = isFocused ? 1.0 : isNeighbor ? 0.65 : focusNode ? 0.08 : 0.5;
        node.emphasis += (target - node.emphasis) * 0.16;
      }

      // ── Read theme colors ──
      const bgColor = getCssVar("--surface");
      const borderColor = getCssVar("--border");
      const textPrimary = getCssVar("--text-primary");
      const textMuted = getCssVar("--text-muted");
      const textFaint = getCssVar("--text-faint");

      // ── Draw ──
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);

      // Edges
      for (const edge of edgeRefs) {
        if (!edge.source || !edge.target) continue;
        const srcEmph = edge.source.emphasis;
        const tgtEmph = edge.target.emphasis;
        const edgeEmph = Math.max(srcEmph, tgtEmph);

        // Alpha based on emphasis
        let alpha: number;
        let lw: number;
        if (edgeEmph > 0.8) {
          alpha = 0.7;
          lw = 1.5;
        } else if (edgeEmph > 0.4) {
          alpha = 0.35;
          lw = 1;
        } else if (focusNode) {
          alpha = 0.06;
          lw = 0.5;
        } else {
          alpha = 0.25;
          lw = 0.8;
        }

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = edgeEmph > 0.4 ? textMuted : borderColor;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(edge.source.x, edge.source.y);
        ctx.lineTo(edge.target.x, edge.target.y);
        ctx.stroke();

        // Arrow head (small, pointing toward target)
        if (lw >= 1) {
          const dx = edge.target.x - edge.source.x;
          const dy = edge.target.y - edge.source.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0) {
            const tr = nodeRadius(edge.target);
            const tipX = edge.target.x - (dx / len) * (tr + 3);
            const tipY = edge.target.y - (dy / len) * (tr + 3);
            const angle = Math.atan2(dy, dx);
            const aSize = 4;
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(
              tipX - aSize * Math.cos(angle - 0.5),
              tipY - aSize * Math.sin(angle - 0.5),
            );
            ctx.lineTo(
              tipX - aSize * Math.cos(angle + 0.5),
              tipY - aSize * Math.sin(angle + 0.5),
            );
            ctx.closePath();
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fill();
          }
        }
      }

      // Nodes
      for (const node of nodes) {
        const r = nodeRadius(node);
        const color = getTypeColor(node.type);
        const baseAlpha = nodeBaseAlpha(node.mtime);
        const emph = node.emphasis;

        // Radius scales up slightly when emphasized
        const rScale = emph > 0.8 ? 1.2 : emph > 0.4 ? 1.08 : 1.0;
        const dr = r * rScale;

        // Alpha: combine base (mtime) with emphasis
        const alpha =
          emph > 0.8 ? 1.0 : emph > 0.4 ? 0.9 : focusNode ? emph * 0.8 + 0.15 : baseAlpha;
        ctx.globalAlpha = alpha;

        // Glow for emphasized nodes
        if (emph > 0.6) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 8 * emph;
        } else {
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
        }

        // Node circle
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, dr, 0, Math.PI * 2);
        ctx.fill();

        // Selection ring
        if (node.fileName === selectedNode) {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = textPrimary;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(node.x, node.y, dr + 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";

        // Label
        const labelAlpha = emph > 0.8 ? 1 : emph > 0.4 ? 0.75 : focusNode ? 0.15 : 0.6;
        ctx.globalAlpha = labelAlpha;
        ctx.fillStyle = emph > 0.8 ? textPrimary : textMuted;
        ctx.font = `${emph > 0.8 ? 11 : 10}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        const label =
          node.name.length > 18 ? node.name.slice(0, 16) + "\u2026" : node.name;
        ctx.fillText(label, node.x, node.y + dr + 14);
      }

      ctx.globalAlpha = 1;
      ctx.restore();

      frame++;
      animRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [
    graph,
    selectedNode,
    hoveredNode,
    neighborsOf,
    nodeBaseAlpha,
    nodeRadius,
  ]);

  // Resize — just flag; the render loop applies the resize and immediately redraws
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    // Initial size
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width = container.clientWidth + "px";
    canvas.style.height = container.clientHeight + "px";
    const ro = new ResizeObserver(() => {
      needsResizeRef.current = true;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Hit testing helper
  const hitTest = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): GraphNodePos | undefined => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      return nodesRef.current.find((n) => {
        const dx = n.x - x;
        const dy = n.y - y;
        const r = nodeRadius(n);
        return dx * dx + dy * dy < (r + 6) * (r + 6);
      });
    },
    [nodeRadius],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const hit = hitTest(e);
      if (hit) {
        onSelectNode(hit.fileName === selectedNode ? null : hit.fileName);
        // Open in Preview tab
        const node = graph.nodes.find((n) => n.fileName === hit.fileName);
        if (node?.filePath) {
          onOpenFile(node.filePath);
        }
      } else {
        onSelectNode(null);
      }
    },
    [hitTest, onSelectNode, selectedNode, graph.nodes, onOpenFile],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const hit = hitTest(e);
      const next = hit?.fileName ?? null;
      if (next !== hoveredNode) setHoveredNode(next);
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = hit ? "pointer" : "default";
    },
    [hitTest, hoveredNode],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredNode(null);
  }, []);

  // Hover tooltip data
  const hovered = hoveredNode
    ? nodesRef.current.find((n) => n.fileName === hoveredNode)
    : null;

  return (
    <div ref={containerRef} className="flex-1 min-h-0 relative">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="absolute inset-0"
      />
      {/* Hover tooltip */}
      {hovered && (
        <div
          className="absolute top-2 right-2 max-w-[200px] px-3 py-2 rounded-lg text-xs
            backdrop-blur-md border border-[var(--border)]
            shadow-lg pointer-events-none transition-opacity duration-150"
          style={{ backgroundColor: "color-mix(in srgb, var(--surface) 90%, transparent)" }}
        >
          <div className="font-medium text-[var(--text-primary)] truncate">
            {hovered.name}
          </div>
          {hovered.description && (
            <div className="text-[var(--text-muted)] mt-0.5 line-clamp-2">
              {hovered.description}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: getTypeColor(hovered.type) }}
            />
            <span className="text-[var(--text-secondary)]">{hovered.type}</span>
          </div>
        </div>
      )}
      {/* Legend */}
      {graph.nodes.length > 0 && (
        <div className="absolute bottom-2 left-2 flex gap-2.5 text-[9px] text-[var(--text-faint)]">
          {(["user", "feedback", "project", "reference"] as const).map((t) => (
            <span key={t} className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ backgroundColor: getTypeColor(t) }}
              />
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MemoryContent (main export) ──────────────────────────────────────

interface Props {
  worktreePath: string | null;
  onFileClick: (filePath: string) => void;
}

export function MemoryContent({ worktreePath, onFileClick }: Props) {
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
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    window.termcanvas.memory.watch(worktreePath);
    const unsubscribe = window.termcanvas.memory.onChanged((updatedGraph) => {
      if (!cancelled) setGraph(updatedGraph);
    });

    return () => {
      cancelled = true;
      window.termcanvas.memory.unwatch(worktreePath);
      unsubscribe();
    };
  }, [worktreePath, setGraph, setLoading]);

  if (!worktreePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-xs">
        No worktree selected
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-xs">
        Loading memories...
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-xs px-4 text-center leading-relaxed">
        No memory files found.
        <br />
        Claude Code stores memories in ~/.claude/projects/
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <MemoryGraph
        graph={graph}
        selectedNode={selectedNode}
        onSelectNode={setSelectedNode}
        onOpenFile={onFileClick}
      />
    </div>
  );
}
