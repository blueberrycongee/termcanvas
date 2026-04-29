import { useEffect, useRef, useCallback, useState } from "react";
import { useMemoryStore, positionKey } from "../../stores/memoryStore";
import { useT } from "../../i18n/useT";

const themeCache = { theme: "", vars: {} as Record<string, string> };

// Canvas drawing can't read `var(--token)` directly, so we resolve the
// computed string per theme and cache it. Listed once here so a token
// change in index.css propagates to the graph without a parallel edit.
const READ_TOKENS = [
  "--surface",
  "--border",
  "--text-primary",
  "--text-muted",
  "--text-faint",
  "--accent",
  "--cyan",
  "--amber",
  "--purple",
] as const;

function getCssVar(name: string): string {
  const currentTheme =
    document.documentElement.getAttribute("data-theme") || "dark";
  if (themeCache.theme !== currentTheme) {
    const style = getComputedStyle(document.documentElement);
    themeCache.theme = currentTheme;
    const next: Record<string, string> = {};
    for (const token of READ_TOKENS) {
      next[token] = style.getPropertyValue(token).trim();
    }
    themeCache.vars = next;
  }
  return themeCache.vars[name] ?? "";
}

// Memory entry → semantic token. Mirrors the design-system role each
// type already plays elsewhere in the app (user→accent, project→amber, …).
const TYPE_TOKEN: Record<string, string> = {
  index: "--text-primary",
  user: "--accent",
  feedback: "--cyan",
  project: "--amber",
  reference: "--purple",
  unknown: "--text-muted",
};

function getTypeColor(type: string): string {
  return getCssVar(TYPE_TOKEN[type] ?? TYPE_TOKEN.unknown);
}

interface GraphNodePos {
  fileName: string;
  filePath: string;
  name: string;
  type: string;
  description: string;
  mtime: number;
  x: number;
  y: number;
  emphasis: number; // 0..1 animated
}

// Run the force simulation offscreen to a stable configuration before
// the nodes are ever painted. The previous implementation stepped the
// simulation inside the render loop for the first 300 animation frames,
// which meant every mount (tab switch, scan-on-change event, etc.) made
// the whole graph visibly fly around for five seconds. Relaying out
// synchronously here, then caching the result in the store, means the
// user sees a settled graph on first paint and subsequent visits.
function relaxLayout(
  positions: Map<string, { x: number; y: number; vx: number; vy: number }>,
  edges: Array<{ source: string; target: string }>,
  cx: number,
  cy: number,
  w: number,
  h: number,
  iterations: number,
): void {
  const keys = Array.from(positions.keys());
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < keys.length; i++) {
      const ni = positions.get(keys[i])!;
      for (let j = i + 1; j < keys.length; j++) {
        const nj = positions.get(keys[j])!;
        const dx = nj.x - ni.x;
        const dy = nj.y - ni.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 1200 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        ni.vx -= fx;
        ni.vy -= fy;
        nj.vx += fx;
        nj.vy += fy;
      }
    }
    for (const e of edges) {
      const s = positions.get(e.source);
      const t = positions.get(e.target);
      if (!s || !t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (dist - 100) * 0.01;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }
    for (const p of positions.values()) {
      p.vx += (cx - p.x) * 0.004;
      p.vy += (cy - p.y) * 0.004;
      p.vx *= 0.86;
      p.vy *= 0.86;
      p.x += p.vx;
      p.y += p.vy;
      p.x = Math.max(24, Math.min(w - 24, p.x));
      p.y = Math.max(24, Math.min(h - 24, p.y));
    }
  }
}

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
    dirPath: string;
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
  const hoveredNodeRef = useRef<string | null>(null);
  const selectedNodeRef = useRef<string | null>(selectedNode);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  selectedNodeRef.current = selectedNode;

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

  // Build (or reuse) stable positions whenever the set of nodes or
  // edges changes. We DON'T reset every node on every graph update
  // — nodes already laid out keep their coordinates, only genuinely
  // new files get seeded around the circle and relaxed alongside
  // their neighbours. This is what eliminates the "nodes shake when
  // you click into memory" behaviour: there is no ongoing physics
  // loop to restart.
  useEffect(() => {
    const w = containerRef.current?.clientWidth ?? 300;
    const h = containerRef.current?.clientHeight ?? 300;
    const cx = w / 2;
    const cy = h / 2;
    const dirPath = graph.dirPath;
    const cache = useMemoryStore.getState().nodePositions;

    const working = new Map<
      string,
      { x: number; y: number; vx: number; vy: number }
    >();
    const freshlySeeded: string[] = [];
    const nonIndex = graph.nodes.filter((n) => n.type !== "index");

    for (const n of graph.nodes) {
      const key = positionKey(dirPath, n.fileName);
      const cached = cache.get(key);
      if (cached) {
        working.set(n.fileName, { x: cached.x, y: cached.y, vx: 0, vy: 0 });
        continue;
      }
      if (n.type === "index") {
        working.set(n.fileName, { x: cx, y: cy, vx: 0, vy: 0 });
        freshlySeeded.push(n.fileName);
        continue;
      }
      const i = nonIndex.indexOf(n);
      const angle = (2 * Math.PI * i) / Math.max(nonIndex.length, 1);
      const r = Math.min(w, h) * 0.28;
      working.set(n.fileName, {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        vx: 0,
        vy: 0,
      });
      freshlySeeded.push(n.fileName);
    }

    // Only relax when something actually changed layout-wise —
    // otherwise every memory.onChanged event (file save, etc.)
    // would re-run the simulation even though the graph is
    // identical. A short pass (150 iters) is enough to integrate
    // new nodes without visibly jostling the ones we reused.
    if (freshlySeeded.length > 0 && w > 0 && h > 0) {
      relaxLayout(working, graph.edges, cx, cy, w, h, 150);
      const toCache: Array<[string, { x: number; y: number }]> = [];
      for (const [fileName, p] of working) {
        toCache.push([
          positionKey(dirPath, fileName),
          { x: p.x, y: p.y },
        ]);
      }
      useMemoryStore.getState().mergeNodePositions(toCache);
    }

    // Preserve emphasis across re-layouts so hover/selection
    // highlights don't flicker.
    const prevEmphasis = new Map(
      nodesRef.current.map((n) => [n.fileName, n.emphasis]),
    );
    nodesRef.current = graph.nodes.map((n) => {
      const p = working.get(n.fileName)!;
      return {
        ...n,
        x: p.x,
        y: p.y,
        emphasis: prevEmphasis.get(n.fileName) ?? 0,
      };
    });
  }, [graph.dirPath, graph.nodes, graph.edges]);

  const nodeBaseAlpha = useCallback((mtime: number): number => {
    const ageMs = Date.now() - mtime;
    const dayMs = 86400000;
    if (ageMs < dayMs) return 1.0;
    if (ageMs < 7 * dayMs) return 0.88;
    if (ageMs < 30 * dayMs) return 0.72;
    return 0.55;
  }, []);

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

    const tick = () => {
      const focusNode = hoveredNodeRef.current ?? selectedNodeRef.current;
      const focusNeighbors = focusNode ? neighborsOf(focusNode) : new Set<string>();
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

      // Positions are pre-relaxed in the layout effect above and
      // cached in the store, so the render loop only handles paint
      // + emphasis smoothing — no live physics.

      for (const node of nodes) {
        const isFocused =
          node.fileName === hoveredNodeRef.current || node.fileName === selectedNodeRef.current;
        const isNeighbor = focusNeighbors.has(node.fileName);
        const target = isFocused ? 1.0 : isNeighbor ? 0.65 : focusNode ? 0.08 : 0.5;
        node.emphasis += (target - node.emphasis) * 0.16;
      }

      const bgColor = getCssVar("--surface");
      const borderColor = getCssVar("--border");
      const textPrimary = getCssVar("--text-primary");
      const textMuted = getCssVar("--text-muted");
      const textFaint = getCssVar("--text-faint");

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);

      for (const edge of edgeRefs) {
        if (!edge.source || !edge.target) continue;
        const srcEmph = edge.source.emphasis;
        const tgtEmph = edge.target.emphasis;
        const edgeEmph = Math.max(srcEmph, tgtEmph);

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

      for (const node of nodes) {
        const r = nodeRadius(node);
        const color = getTypeColor(node.type);
        const baseAlpha = nodeBaseAlpha(node.mtime);
        const emph = node.emphasis;

        const rScale = emph > 0.8 ? 1.2 : emph > 0.4 ? 1.08 : 1.0;
        const dr = r * rScale;

        const alpha =
          emph > 0.8 ? 1.0 : emph > 0.4 ? 0.9 : focusNode ? emph * 0.8 + 0.15 : baseAlpha;
        ctx.globalAlpha = alpha;

        if (emph > 0.6) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 8 * emph;
        } else {
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, dr, 0, Math.PI * 2);
        ctx.fill();

        // Selection ring
        if (node.fileName === selectedNodeRef.current) {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = textPrimary;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(node.x, node.y, dr + 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";

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

      animRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [
    graph,
    neighborsOf,
    nodeBaseAlpha,
    nodeRadius,
  ]);

  // Resize — just flag; the render loop applies the resize and immediately redraws
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
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
        const isDeselecting = hit.fileName === selectedNode;
        onSelectNode(isDeselecting ? null : hit.fileName);
        if (!isDeselecting) {
          const node = graph.nodes.find((n) => n.fileName === hit.fileName);
          if (node?.filePath) {
            onOpenFile(node.filePath);
          }
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
      if (next !== hoveredNodeRef.current) {
        hoveredNodeRef.current = next;
        setHoveredNode(next);
      }
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = hit ? "pointer" : "default";
    },
    [hitTest],
  );

  const handleMouseLeave = useCallback(() => {
    hoveredNodeRef.current = null;
    setHoveredNode(null);
  }, []);

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
      {hovered && (
        <div
          className="absolute top-2 right-2 max-w-[200px] px-3 py-2 rounded-lg text-xs
            backdrop-blur-md border border-[var(--border)]
            shadow-lg pointer-events-none transition-opacity duration-quick"
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

interface Props {
  worktreePath: string | null;
  onFileClick: (filePath: string) => void;
}

export function MemoryContent({ worktreePath, onFileClick }: Props) {
  const t = useT();
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
      <div className="tc-label flex-1 flex items-center justify-center">
        {t.no_worktree_selected}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="tc-label flex-1 flex items-center justify-center">
        {t.memory_loading}
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="tc-label flex-1 flex flex-col items-center justify-center px-4 text-center leading-relaxed">
        <span>{t.memory_empty}</span>
        <span>{t.memory_empty_hint}</span>
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
