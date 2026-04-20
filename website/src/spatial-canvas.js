// spatial-canvas.js — Brutalist spatial canvas visualization

const BRAND_COLORS = [
  { name: "accent", hex: "#c9a03a" },
  { name: "cyan", hex: "#6cc4b0" },
  { name: "green", hex: "#4ade80" },
  { name: "purple", hex: "#9b7ad8" },
];

const LABELS = ["claude", "codex", "git", "build", "node", "server", "test", "deploy", "lint", "hydra"];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function createWindow(id) {
  const color = BRAND_COLORS[id % BRAND_COLORS.length];
  const label = LABELS[id % LABELS.length];
  const w = 80 + Math.random() * 120;
  const h = 60 + Math.random() * 60;
  return {
    id,
    x: (Math.random() - 0.5) * 1600,
    y: (Math.random() - 0.5) * 900,
    w,
    h,
    color,
    label,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    scale: 1,
    scalePhase: Math.random() * Math.PI * 2,
    scaleSpeed: 0.8 + Math.random() * 1.2,
    hovered: false,
    contentLines: Array.from({ length: 3 + Math.floor(Math.random() * 4) }, () =>
      0.3 + Math.random() * 0.6
    ),
  };
}

function init(container) {
  const canvas = container.querySelector("canvas");
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext("2d");

  let width = 0;
  let height = 0;
  let mouseX = 0;
  let mouseY = 0;
  let mouseInCanvas = false;
  let cameraX = 0;
  let cameraY = 0;
  let zoom = 1;

  const windows = Array.from({ length: 10 }, (_, i) => createWindow(i));

  function resize() {
    const rect = container.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
  }

  resize();
  window.addEventListener("resize", resize);

  container.addEventListener("mousemove", (e) => {
    const rect = container.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    mouseInCanvas = true;
  });

  container.addEventListener("mouseleave", () => {
    mouseInCanvas = false;
  });

  container.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = Math.max(0.5, Math.min(2.5, zoom * delta));
  }, { passive: false });

  function worldToScreen(wx, wy) {
    const cx = width / 2 - cameraX;
    const cy = height / 2 - cameraY;
    return {
      x: cx + wx * zoom,
      y: cy + wy * zoom,
    };
  }

  function screenToWorld(sx, sy) {
    const cx = width / 2 - cameraX;
    const cy = height / 2 - cameraY;
    return {
      x: (sx - cx) / zoom,
      y: (sy - cy) / zoom,
    };
  }

  function drawGrid() {
    const spacing = 40 * zoom;
    const offsetX = (width / 2 - cameraX) % spacing;
    const offsetY = (height / 2 - cameraY) % spacing;

    ctx.fillStyle = "#111";
    for (let x = offsetX; x < width; x += spacing) {
      for (let y = offsetY; y < height; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawWindow(win, time) {
    const pos = worldToScreen(win.x, win.y);
    const sw = win.w * zoom;
    const sh = win.h * zoom;
    const rgb = hexToRgb(win.color.hex);
    const alpha = win.hovered ? 0.5 : 0.25;
    const borderAlpha = win.hovered ? 0.7 : 0.3;

    const breath = 1 + Math.sin(time * 0.001 * win.scaleSpeed + win.scalePhase) * 0.02;
    const scale = zoom * breath;
    const bw = win.w * scale;
    const bh = win.h * scale;
    const bx = pos.x - bw / 2;
    const by = pos.y - bh / 2;

    // Body
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.04)`;
    ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${borderAlpha})`;
    ctx.lineWidth = 1;
    roundRect(ctx, bx, by, bw, bh, 4 * scale);
    ctx.fill();
    ctx.stroke();

    // Title bar
    const titleH = 20 * scale;
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.1)`;
    ctx.beginPath();
    ctx.moveTo(bx + 4 * scale, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + titleH, 4 * scale);
    ctx.lineTo(bx + bw, by + titleH);
    ctx.lineTo(bx, by + titleH);
    ctx.lineTo(bx, by + 4 * scale);
    ctx.arcTo(bx, by, bx + bw, by, 4 * scale);
    ctx.closePath();
    ctx.fill();

    // Label
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.7)`;
    ctx.font = `${Math.max(7, 8 * scale)}px "Geist Mono", monospace`;
    ctx.textBaseline = "middle";
    ctx.fillText(win.label, bx + 8 * scale, by + titleH / 2);

    // Content lines
    const lineY = by + titleH + 8 * scale;
    const lineH = Math.max(2, 3 * scale);
    const lineGap = Math.max(4, 6 * scale);
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.25)`;
    for (let i = 0; i < win.contentLines.length; i++) {
      const lw = (bw - 16 * scale) * win.contentLines[i];
      ctx.fillRect(bx + 8 * scale, lineY + i * lineGap, lw, lineH);
    }
  }

  function drawConnections(time) {
    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        const a = windows[i];
        const b = windows[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 500) continue;

        const pa = worldToScreen(a.x, a.y);
        const pb = worldToScreen(b.x, b.y);
        const rgb = hexToRgb(a.color.hex);
        const pulse = 0.5 + Math.sin(time * 0.0008 + i) * 0.5;
        const alpha = (1 - dist / 500) * 0.06 * pulse;

        ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        const cpx = (pa.x + pb.x) / 2 + (Math.sin(time * 0.0005 + i) * 30);
        const cpy = (pa.y + pb.y) / 2 + (Math.cos(time * 0.0005 + j) * 20);
        ctx.quadraticCurveTo(cpx, cpy, pb.x, pb.y);
        ctx.stroke();
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function update(time) {
    // Float windows
    for (const win of windows) {
      win.x += win.vx;
      win.y += win.vy;
      if (win.x < -900 || win.x > 900) win.vx *= -1;
      if (win.y < -500 || win.y > 500) win.vy *= -1;
    }

    // Parallax camera
    if (mouseInCanvas) {
      const targetCamX = (mouseX - width / 2) * 0.3;
      const targetCamY = (mouseY - height / 2) * 0.3;
      cameraX += (targetCamX - cameraX) * 0.05;
      cameraY += (targetCamY - cameraY) * 0.05;
    } else {
      cameraX += (0 - cameraX) * 0.03;
      cameraY += (0 - cameraY) * 0.03;
    }

    // Hover detection
    for (const win of windows) {
      const pos = worldToScreen(win.x, win.y);
      const sw = win.w * zoom;
      const sh = win.h * zoom;
      const dx = mouseX - pos.x;
      const dy = mouseY - pos.y;
      win.hovered = mouseInCanvas && Math.abs(dx) < sw / 2 + 10 && Math.abs(dy) < sh / 2 + 10;
    }
  }

  function render(time) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    drawGrid();
    drawConnections(time);

    // Sort by y for pseudo-depth
    const sorted = [...windows].sort((a, b) => a.y - b.y);
    for (const win of sorted) {
      drawWindow(win, time);
    }
  }

  let raf = null;
  let lastTime = 0;

  function loop(time) {
    update(time);
    render(time);
    raf = requestAnimationFrame(loop);
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    render(0);
    return;
  }

  // IntersectionObserver to pause when off-screen
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (!raf) raf = requestAnimationFrame(loop);
        } else {
          if (raf) {
            cancelAnimationFrame(raf);
            raf = null;
          }
        }
      });
    },
    { threshold: 0.1 }
  );

  observer.observe(container);
  raf = requestAnimationFrame(loop);

  return () => {
    if (raf) cancelAnimationFrame(raf);
    observer.disconnect();
    window.removeEventListener("resize", resize);
  };
}

export { init };
