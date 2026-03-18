// demo/ascii-logo.js

const RAMP = " .:-=+*#%@$";

/**
 * Sample an OffscreenCanvas and return an array of strings (one per row).
 * Each character maps to the brightness of the corresponding cell.
 */
function canvasToAscii(ctx, canvasWidth, canvasHeight, cols, rows) {
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const { data } = imageData;
  const cellW = canvasWidth / cols;
  const cellH = canvasHeight / rows;
  const lines = [];

  for (let row = 0; row < rows; row++) {
    let line = "";
    for (let col = 0; col < cols; col++) {
      // Sample center of each cell
      const px = Math.floor(col * cellW + cellW / 2);
      const py = Math.floor(row * cellH + cellH / 2);
      const i = (py * canvasWidth + px) * 4;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3 / 255;
      line += RAMP[Math.floor(brightness * (RAMP.length - 1))];
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Draw the termcanvas logo onto the given 2D context.
 * All coordinates are normalized to [0, 1] range, scaled to canvas size.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w - canvas width
 * @param {number} h - canvas height
 * @param {object} eye - { state, openAmount, pupilX, pupilY } for eye rendering
 */
function drawLogo(ctx, w, h, eye) {
  ctx.clearRect(0, 0, w, h);

  // Logo proportions from SVG (1024x1024 viewbox):
  // Outer rect: x=72 y=72 w=880 h=880 rx=224
  // Frame path: outer M208,188 H816 V872 H208 Z  inner M316,296 H708 V764 H316 Z
  // Cursor rect: x=461 y=376 w=102 h=308

  const scale = (v) => v / 1024;
  const sx = (v) => scale(v) * w;
  const sy = (v) => scale(v) * h;

  // 1. Outer rounded rect (light background)
  const outerX = sx(72), outerY = sy(72), outerW = sx(880), outerH = sy(880);
  const radius = sx(224);
  ctx.fillStyle = "#1a1a1a"; // subtle outline of the icon shape
  roundRect(ctx, outerX, outerY, outerW, outerH, radius);
  ctx.fill();

  // 2. Terminal frame (bright = will become dense characters)
  ctx.fillStyle = "#e0e0e0";
  ctx.fillRect(sx(208), sy(188), sx(608), sy(684));

  // 3. Screen interior (dark = will become spaces)
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(sx(316), sy(296), sx(392), sy(468));

  // 4. Cursor / Eye
  drawCursorOrEye(ctx, w, h, eye);
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

/**
 * Draw the cursor (vertical bar) or eye depending on state.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w - canvas width
 * @param {number} h - canvas height
 * @param {object} eye - { state, openAmount, pupilX, pupilY, blinkVisible }
 *   - state: "idle" | "awakening" | "tracking" | "sleeping"
 *   - openAmount: 0 (closed/cursor) to 1 (fully open eye), used during transitions
 *   - pupilX, pupilY: normalized pupil offset [-1, 1]
 *   - blinkVisible: boolean, whether cursor is visible during blink cycle
 */
function drawCursorOrEye(ctx, w, h, eye) {
  const sx = (v) => (v / 1024) * w;
  const sy = (v) => (v / 1024) * h;

  // Center of the cursor area from SVG: x=461+51=512, y=376+154=530
  const cx = sx(512);
  const cy = sy(530);

  // Cursor dimensions from SVG: w=102, h=308
  const cursorHalfW = sx(51);
  const cursorHalfH = sy(154);

  if (eye.state === "idle" && !eye.blinkVisible) {
    return; // cursor blink off phase
  }

  const t = eye.openAmount; // 0 = cursor bar, 1 = fully open eye

  // Interpolate from cursor bar to eye ellipse
  const eyeRadiusX = cursorHalfW + t * (sx(120) - cursorHalfW); // widen
  const eyeRadiusY = cursorHalfH + t * (sy(100) - cursorHalfH); // shorten to ellipse

  // Draw eye/cursor shape
  ctx.fillStyle = "#e0e0e0";
  ctx.beginPath();
  ctx.ellipse(cx, cy, eyeRadiusX, eyeRadiusY, 0, 0, Math.PI * 2);
  ctx.fill();

  // Draw pupil when eye is opening
  if (t > 0.1) {
    const pupilRadius = sx(40) * t;
    const maxOffset = sx(50);
    const px = cx + eye.pupilX * maxOffset * t;
    const py = cy + eye.pupilY * maxOffset * t;

    ctx.fillStyle = "#0a0a0a";
    ctx.beginPath();
    ctx.arc(px, py, pupilRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}
