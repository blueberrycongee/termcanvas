// demo/ascii-logo.js — smooth true-color ASCII logo animation
// Renders to <canvas> with fillText for zero DOM overhead per frame.

// ── Configuration ────────────────────────────────────────────────────

const RAMP = " .:-=+*#%@$";

const H_WAVES = [
  { speed: 0.0010, freq: 0.12, amp: 0.45 },
  { speed: 0.0022, freq: 0.28, amp: 0.25 },
  { speed: 0.0038, freq: 0.06, amp: 0.12 },
];
const V_WAVES = [
  { speed: 0.0007, freq: 0.09, amp: 0.40 },
  { speed: 0.0017, freq: 0.22, amp: 0.22 },
  { speed: 0.0032, freq: 0.04, amp: 0.15 },
];
const MAX_AMP_X = 1.6;
const MAX_AMP_Y = 0.8;

const BLINK_INTERVAL = 530;
const AWAKEN_DURATION = 500;
const SLEEP_DURATION = 500;
const SLEEP_AFTER = 3000;
const PUPIL_LERP = 0.08;

// ── Wave Functions ───────────────────────────────────────────────────

function easeWave(x) {
  const abs = Math.abs(x);
  const eased = abs * abs * (3 - 2 * abs);
  return Math.sign(x) * eased;
}

function organicWave(t, phase, freqs) {
  let v = 0;
  for (let i = 0; i < freqs.length; i++) {
    const { speed, freq, amp } = freqs[i];
    v += Math.sin(t * speed + phase * freq) * amp;
  }
  return easeWave(v);
}

// ── Source Canvas Drawing ────────────────────────────────────────────

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

function drawLogo(ctx, w, h, eye) {
  ctx.clearRect(0, 0, w, h);
  const sx = (v) => (v / 1024) * w;
  const sy = (v) => (v / 1024) * h;

  // 1. Outer rounded rect with subtle gradient
  const outerGrad = ctx.createLinearGradient(sx(72), sy(72), sx(952), sy(952));
  outerGrad.addColorStop(0, "#1e1e1e");
  outerGrad.addColorStop(1, "#161616");
  ctx.fillStyle = outerGrad;
  roundRect(ctx, sx(72), sy(72), sx(880), sy(880), sx(224));
  ctx.fill();

  // 2. Terminal frame with vertical gradient + soft glow
  ctx.save();
  const frameGrad = ctx.createLinearGradient(sx(512), sy(188), sx(512), sy(872));
  frameGrad.addColorStop(0, "#dca830");
  frameGrad.addColorStop(0.5, "#e8b840");
  frameGrad.addColorStop(1, "#d4a030");
  ctx.shadowColor = "rgba(224, 168, 48, 0.35)";
  ctx.shadowBlur = sx(18);
  ctx.fillStyle = frameGrad;
  ctx.fillRect(sx(208), sy(188), sx(608), sy(684));
  ctx.restore();

  // 3. Screen interior
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(sx(316), sy(296), sx(392), sy(468));

  // 4. Cursor / Eye
  drawCursorOrEye(ctx, w, h, eye);
}

function drawCursorOrEye(ctx, w, h, eye) {
  const sx = (v) => (v / 1024) * w;
  const sy = (v) => (v / 1024) * h;
  const cx = sx(512), cy = sy(530);
  const cursorHalfW = sx(51), cursorHalfH = sy(154);

  if (eye.state === "idle" && !eye.blinkVisible) return;

  const t = eye.openAmount;
  const eyeRX = cursorHalfW + t * (sx(120) - cursorHalfW);
  const eyeRY = cursorHalfH + t * (sy(100) - cursorHalfH);

  ctx.save();
  ctx.shadowColor = "rgba(64, 144, 224, 0.45)";
  ctx.shadowBlur = sx(22);
  const eyeGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(eyeRX, eyeRY));
  eyeGrad.addColorStop(0, "#60b0f0");
  eyeGrad.addColorStop(0.6, "#4090e0");
  eyeGrad.addColorStop(1, "#3070c0");
  ctx.fillStyle = eyeGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, eyeRX, eyeRY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (t > 0.1) {
    const pupilR = sx(40) * t;
    const maxOff = sx(50);
    const px = cx + eye.pupilX * maxOff * t;
    const py = cy + eye.pupilY * maxOff * t;
    ctx.fillStyle = "#0a0a0a";
    ctx.beginPath();
    ctx.arc(px, py, pupilR, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Color Mapping ────────────────────────────────────────────────────

const colorCache = new Map();

function getDisplayColor(r, g, b) {
  // Quantize input to reduce unique colors and cache hits
  r = (r >> 3) << 3;
  g = (g >> 3) << 3;
  b = (b >> 3) << 3;

  const key = (r << 16) | (g << 8) | b;
  let cached = colorCache.get(key);
  if (cached !== undefined) return cached;

  const maxC = Math.max(r, g, b);
  if (maxC < 10) {
    colorCache.set(key, null);
    return null;
  }

  const minC = Math.min(r, g, b);
  const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
  const avg = (r + g + b) / 3;

  let dr, dg, db;
  if (sat < 0.15) {
    const v = 60 + Math.round(avg * 0.7);
    dr = dg = db = v;
  } else {
    const target = 190 + (avg / 255) * 65;
    const scale = target / maxC;
    dr = Math.min(255, Math.round(r * scale));
    dg = Math.min(255, Math.round(g * scale));
    db = Math.min(255, Math.round(b * scale));
  }

  const color = `rgb(${dr},${dg},${db})`;
  colorCache.set(key, color);
  return color;
}

// ── Eye State Machine ────────────────────────────────────────────────

function createEyeState() {
  return {
    state: "idle",
    openAmount: 0,
    pupilX: 0,
    pupilY: 0,
    blinkVisible: true,
    blinkTimer: 0,
    idleTimer: 0,
    targetPupilX: 0,
    targetPupilY: 0,
    lastTime: 0,
  };
}

function updateEyeState(eye, time) {
  const dt = eye.lastTime === 0 ? 16 : time - eye.lastTime;
  eye.lastTime = time;

  switch (eye.state) {
    case "idle":
      eye.blinkTimer += dt;
      if (eye.blinkTimer >= BLINK_INTERVAL) {
        eye.blinkVisible = !eye.blinkVisible;
        eye.blinkTimer = 0;
      }
      eye.openAmount = 0;
      break;
    case "awakening":
      eye.openAmount = Math.min(1, eye.openAmount + dt / AWAKEN_DURATION);
      eye.blinkVisible = true;
      eye.pupilX += (eye.targetPupilX - eye.pupilX) * PUPIL_LERP;
      eye.pupilY += (eye.targetPupilY - eye.pupilY) * PUPIL_LERP;
      if (eye.openAmount >= 1) {
        eye.state = "tracking";
        eye.idleTimer = 0;
      }
      break;
    case "tracking":
      eye.openAmount = 1;
      eye.pupilX += (eye.targetPupilX - eye.pupilX) * PUPIL_LERP;
      eye.pupilY += (eye.targetPupilY - eye.pupilY) * PUPIL_LERP;
      eye.idleTimer += dt;
      if (eye.idleTimer >= SLEEP_AFTER) eye.state = "sleeping";
      break;
    case "sleeping":
      eye.openAmount = Math.max(0, eye.openAmount - dt / SLEEP_DURATION);
      eye.pupilX += (0 - eye.pupilX) * PUPIL_LERP;
      eye.pupilY += (0 - eye.pupilY) * PUPIL_LERP;
      if (eye.openAmount <= 0) {
        eye.state = "idle";
        eye.blinkTimer = 0;
        eye.blinkVisible = true;
      }
      break;
  }
}

// ── Animation Loop ───────────────────────────────────────────────────

class AnimationLoop {
  #raf = null;
  #callback;

  constructor(callback) {
    this.#callback = callback;
  }

  start() {
    if (this.#raf != null) return;
    const loop = (time) => {
      this.#callback(time);
      this.#raf = requestAnimationFrame(loop);
    };
    this.#raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.#raf != null) {
      cancelAnimationFrame(this.#raf);
      this.#raf = null;
    }
  }
}

// ── Mouse Tracking ───────────────────────────────────────────────────

function setupMouseTracking(eye, element) {
  document.addEventListener("mousemove", (e) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const maxDist = Math.max(rect.width, rect.height);

    eye.targetPupilX = Math.max(-1, Math.min(1, (dx / maxDist) * 2));
    eye.targetPupilY = Math.max(-1, Math.min(1, (dy / maxDist) * 2));

    if (eye.state === "idle" || eye.state === "sleeping") {
      eye.state = "awakening";
    }
    if (eye.state === "tracking") {
      eye.idleTimer = 0;
    }
  });
}

// ── Initialization ───────────────────────────────────────────────────

function init(container) {
  const COLS = 80;
  const ROWS = 40;
  const SRC_SCALE = 6;
  const FONT_SIZE = 12;
  const LINE_HEIGHT = 1.1;

  // Source canvas with willReadFrequently for fast getImageData
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = COLS * SRC_SCALE;
  srcCanvas.height = ROWS * SRC_SCALE;
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });

  // Measure monospace character dimensions
  const dpr = window.devicePixelRatio || 1;
  const fontStr = `${FONT_SIZE}px "Geist Mono","SF Mono","Cascadia Code","Fira Code",Consolas,monospace`;
  const tmpCanvas = document.createElement("canvas");
  const tmpCtx = tmpCanvas.getContext("2d");
  tmpCtx.font = fontStr;
  const charW = tmpCtx.measureText("M").width;
  const charH = FONT_SIZE * LINE_HEIGHT;

  // Display canvas (retina-ready)
  const logicalW = Math.ceil(COLS * charW);
  const logicalH = Math.ceil(ROWS * charH);
  const displayCanvas = document.createElement("canvas");
  displayCanvas.width = Math.ceil(logicalW * dpr);
  displayCanvas.height = Math.ceil(logicalH * dpr);
  displayCanvas.style.width = logicalW + "px";
  displayCanvas.style.height = logicalH + "px";
  container.appendChild(displayCanvas);

  const dispCtx = displayCanvas.getContext("2d");

  const eye = createEyeState();
  setupMouseTracking(eye, displayCanvas);

  // Pre-computed constants for the render loop
  const canvasW = srcCanvas.width;
  const canvasH = srcCanvas.height;
  const cellW = canvasW / COLS;
  const cellH = canvasH / ROWS;
  const halfRows = ROWS / 2;
  const halfCols = COLS / 2;
  const rampLen = RAMP.length - 1;

  function renderFrame(time) {
    const { data } = srcCtx.getImageData(0, 0, canvasW, canvasH);

    dispCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dispCtx.clearRect(0, 0, logicalW, logicalH);
    dispCtx.font = fontStr;
    dispCtx.textBaseline = "top";

    // Slow-moving specular highlight position
    const specTime = time * 0.0003;
    const specX = Math.cos(specTime) * 0.3;
    const specY = Math.sin(specTime * 0.7) * 0.2 - 0.15;

    let lastColor = "";

    for (let row = 0; row < ROWS; row++) {
      const rowEdge = Math.abs(row - halfRows) / halfRows;
      const waveX = organicWave(time, row, H_WAVES) * MAX_AMP_X * rowEdge * cellW;
      const ny = (row - halfRows) / halfRows; // -1 to 1

      for (let col = 0; col < COLS; col++) {
        const colEdge = Math.abs(col - halfCols) / halfCols;
        const waveY = organicWave(time, col, V_WAVES) * MAX_AMP_Y * colEdge * cellH;

        const px = Math.floor(col * cellW + cellW * 0.5 + waveX);
        const py = Math.floor(row * cellH + cellH * 0.5 + waveY);

        if (px < 0 || px >= canvasW || py < 0 || py >= canvasH) continue;

        const i = (py * canvasW + px) << 2;
        let r = data[i], g = data[i + 1], b = data[i + 2];

        // Skip near-black early
        if (r + g + b < 30) continue;

        const nx = (col - halfCols) / halfCols; // -1 to 1

        // Directional light: top-left brighter, bottom-right darker (~8%)
        const directional = 1.0 - 0.08 * (nx * 0.4 + ny * 0.6);

        // Specular highlight: wide soft gaussian bright spot
        const sdx = nx - specX, sdy = ny - specY;
        const specular = Math.exp(-(sdx * sdx + sdy * sdy) * 4) * 0.14;

        // Vignette: very subtle edge darkening (capped at unit circle)
        const vDist = Math.min(1.0, nx * nx + ny * ny);
        const vignette = 1.0 - 0.08 * vDist;

        const lightMul = directional * vignette + specular;

        r = Math.min(255, r * lightMul);
        g = Math.min(255, g * lightMul);
        b = Math.min(255, b * lightMul);

        const brightness = (r + g + b) / 765;
        const ch = RAMP[Math.floor(brightness * rampLen)];
        if (ch === " ") continue;

        const color = getDisplayColor(r, g, b);
        if (!color) continue;

        if (color !== lastColor) {
          dispCtx.fillStyle = color;
          lastColor = color;
        }
        dispCtx.fillText(ch, col * charW, row * charH);
      }
    }
  }

  // Respect prefers-reduced-motion
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    drawLogo(srcCtx, canvasW, canvasH, eye);
    renderFrame(0);
    return;
  }

  const loop = new AnimationLoop((time) => {
    updateEyeState(eye, time);
    drawLogo(srcCtx, canvasW, canvasH, eye);
    renderFrame(time);
  });

  window.addEventListener("blur", () => loop.stop());
  window.addEventListener("focus", () => loop.start());
  if (document.visibilityState === "visible") loop.start();
}

export { init };
