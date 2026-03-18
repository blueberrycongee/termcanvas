# ASCII Logo Animation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone ASCII art animation component that renders the termcanvas logo with an interactive eye that awakens on mouse movement and tracks the cursor.

**Architecture:** OffscreenCanvas draws the logo + eye each frame, pixel brightness is sampled and mapped to density characters, output to a `<pre>` element. A state machine (IDLE → AWAKENING → TRACKING → SLEEPING → IDLE) governs transitions. The demo page is a standalone HTML file using inline React via CDN — completely independent from the main Electron/Vite build.

**Tech Stack:** React 19 (CDN), Canvas 2D API, requestAnimationFrame, no build step needed for demo.

---

### Task 1: Create demo HTML shell

**Files:**
- Create: `demo/ascii-logo.html`

**Step 1: Create the minimal HTML file**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>termcanvas — ASCII Logo</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; background: #0a0a0a; overflow: hidden; }
    #root {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    pre {
      font-family: "Geist Mono", "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
      line-height: 1.1;
      color: #e4e4e7;
      user-select: none;
      cursor: default;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./ascii-logo.js"></script>
</body>
</html>
```

**Step 2: Verify file opens in browser**

Run: `open demo/ascii-logo.html`
Expected: Black page, no errors in console.

**Step 3: Commit**

```bash
git add demo/ascii-logo.html
git commit -m "feat(demo): add ASCII logo demo HTML shell"
```

---

### Task 2: Canvas-to-ASCII rendering engine

**Files:**
- Create: `demo/ascii-logo.js`

This is the core rendering engine. It draws onto a small OffscreenCanvas and converts pixels to characters.

**Step 1: Implement the character density mapper and canvas-to-ASCII converter**

```js
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
```

**Step 2: Test manually — draw a white circle, verify ASCII output in console**

Add temporary test code at the bottom of the file:

```js
// Temporary test — remove after verifying
const testCanvas = new OffscreenCanvas(80, 40);
const testCtx = testCanvas.getContext("2d");
testCtx.fillStyle = "white";
testCtx.beginPath();
testCtx.arc(40, 20, 15, 0, Math.PI * 2);
testCtx.fill();
const result = canvasToAscii(testCtx, 80, 40, 80, 40);
console.log(result.join("\n"));
```

Run: Open `demo/ascii-logo.html` in browser, check console.
Expected: A rough circle made of density characters.

**Step 3: Remove test code, commit**

```bash
git add demo/ascii-logo.js
git commit -m "feat(demo): add canvas-to-ASCII rendering engine"
```

---

### Task 3: Draw the termcanvas logo on Canvas

**Files:**
- Modify: `demo/ascii-logo.js`

Draw the logo shapes onto the OffscreenCanvas. The logo is (from the SVG):
- Outer rounded rectangle (white, the app icon background)
- Dark rectangle with inner cutout (terminal window frame)
- Dark vertical bar in center (cursor)

We draw in grayscale: dark areas = terminal frame (#272727), light areas = background (#FAF9F6), screen interior = light.

Since we're on a dark page and using light-colored ASCII characters, we invert: bright canvas pixels → dense characters. The terminal frame should be dense, the background/screen should be empty.

**Step 1: Implement logo drawing function**

```js
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
```

**Step 2: Implement cursor/eye drawing**

```js
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
```

**Step 3: Test — render a static logo frame to the pre element**

Add temporary test:

```js
const COLS = 80;
const ROWS = 40;
const canvas = new OffscreenCanvas(COLS * 4, ROWS * 4);
const renderCtx = canvas.getContext("2d");

drawLogo(renderCtx, canvas.width, canvas.height, {
  state: "idle",
  openAmount: 0,
  pupilX: 0,
  pupilY: 0,
  blinkVisible: true,
});

const lines = canvasToAscii(renderCtx, canvas.width, canvas.height, COLS, ROWS);
document.querySelector("#root").innerHTML = `<pre>${lines.join("\n")}</pre>`;
```

Run: Open `demo/ascii-logo.html` in browser.
Expected: The termcanvas logo rendered in ASCII characters — terminal frame as dense chars, screen area as spaces, cursor bar in center.

**Step 4: Remove test code, commit**

```bash
git add demo/ascii-logo.js
git commit -m "feat(demo): draw termcanvas logo on canvas with cursor/eye rendering"
```

---

### Task 4: Animation loop and state machine

**Files:**
- Modify: `demo/ascii-logo.js`

**Step 1: Implement the animation controller**

```js
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
```

**Step 2: Implement the state machine**

```js
/**
 * State machine for eye animation.
 * States: idle → awakening → tracking → sleeping → idle
 */
function createEyeState() {
  return {
    state: "idle",          // "idle" | "awakening" | "tracking" | "sleeping"
    openAmount: 0,          // 0 = cursor, 1 = fully open eye
    pupilX: 0,              // [-1, 1] horizontal pupil offset
    pupilY: 0,              // [-1, 1] vertical pupil offset
    blinkVisible: true,     // cursor blink toggle
    blinkTimer: 0,          // ms since last blink toggle
    idleTimer: 0,           // ms since last mouse move (for sleep trigger)
    targetPupilX: 0,        // target pupil position (from mouse)
    targetPupilY: 0,
    lastTime: 0,
  };
}

const BLINK_INTERVAL = 530;    // ms between cursor blink toggles
const AWAKEN_DURATION = 500;   // ms for cursor → eye transition
const SLEEP_DURATION = 500;    // ms for eye → cursor transition
const SLEEP_AFTER = 3000;      // ms of no mouse movement before sleeping
const PUPIL_LERP = 0.08;       // smoothing factor for pupil follow

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
      // Lerp pupil toward target during awakening
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
      if (eye.idleTimer >= SLEEP_AFTER) {
        eye.state = "sleeping";
      }
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
```

**Step 3: Wire up mouse events**

```js
function setupMouseTracking(eye, preElement) {
  document.addEventListener("mousemove", (e) => {
    // Compute pupil target from mouse position relative to page center
    const rect = preElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = Math.max(rect.width, rect.height);

    // Normalize and clamp to [-1, 1]
    eye.targetPupilX = Math.max(-1, Math.min(1, dx / maxDist * 2));
    eye.targetPupilY = Math.max(-1, Math.min(1, dy / maxDist * 2));

    // Wake up if idle
    if (eye.state === "idle") {
      eye.state = "awakening";
    }

    // Reset idle timer if tracking
    if (eye.state === "tracking") {
      eye.idleTimer = 0;
    }
  });
}
```

**Step 4: Create the main render loop that ties everything together**

```js
function init() {
  const COLS = 80;
  const ROWS = 40;

  // Canvas at 4x resolution for smoother sampling
  const canvas = new OffscreenCanvas(COLS * 4, ROWS * 4);
  const ctx = canvas.getContext("2d");

  const pre = document.createElement("pre");
  document.getElementById("root").appendChild(pre);

  const eye = createEyeState();
  setupMouseTracking(eye, pre);

  // Respect prefers-reduced-motion
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    drawLogo(ctx, canvas.width, canvas.height, eye);
    const lines = canvasToAscii(ctx, canvas.width, canvas.height, COLS, ROWS);
    pre.textContent = lines.join("\n");
    return;
  }

  const loop = new AnimationLoop((time) => {
    updateEyeState(eye, time);
    drawLogo(ctx, canvas.width, canvas.height, eye);
    const lines = canvasToAscii(ctx, canvas.width, canvas.height, COLS, ROWS);
    pre.textContent = lines.join("\n");
  });

  // Pause on blur, resume on focus
  window.addEventListener("blur", () => loop.stop());
  window.addEventListener("focus", () => loop.start());
  if (document.visibilityState === "visible") loop.start();
}

init();
```

**Step 5: Test the full animation**

Run: Open `demo/ascii-logo.html` in browser, move mouse around.
Expected:
- Logo displays with blinking cursor
- Moving mouse causes cursor to expand into an eye
- Eye pupil follows mouse direction
- Stopping mouse for 3s causes eye to close back to cursor

**Step 6: Commit**

```bash
git add demo/ascii-logo.js
git commit -m "feat(demo): add animation loop, state machine, and mouse tracking"
```

---

### Task 5: Polish and tune

**Files:**
- Modify: `demo/ascii-logo.js`
- Modify: `demo/ascii-logo.html`

**Step 1: Responsive font sizing**

Add to `demo/ascii-logo.html` style block:

```css
pre {
  font-size: 12px;
}
@media (max-width: 700px) {
  pre { font-size: 8px; }
}
@media (max-width: 500px) {
  pre { font-size: 6px; }
}
```

**Step 2: Add "termcanvas" title text below the logo**

Add to HTML after `<div id="root">`:

```html
<p style="
  font-family: 'Geist Mono', monospace;
  color: #71717a;
  text-align: center;
  margin-top: 1rem;
  font-size: 14px;
  letter-spacing: 0.2em;
">termcanvas</p>
```

**Step 3: Fine-tune animation parameters**

Adjust these values in `demo/ascii-logo.js` based on how it feels:
- `PUPIL_LERP`: increase to 0.1 if pupil feels sluggish, decrease to 0.06 if jittery
- `SLEEP_AFTER`: try 2000-4000ms range
- `AWAKEN_DURATION` / `SLEEP_DURATION`: try 300-700ms
- Eye ellipse proportions: adjust `sx(120)` (eye width) and `sy(100)` (eye height) for the right eye shape
- Pupil size: adjust `sx(40)` for pupil radius
- Canvas multiplier: try 3x-6x to find best ASCII fidelity

**Step 4: Test across different viewport sizes**

Resize browser window. Expected: font scales down gracefully, animation remains visible.

**Step 5: Commit**

```bash
git add demo/ascii-logo.html demo/ascii-logo.js
git commit -m "feat(demo): polish responsive sizing and animation tuning"
```

---

### Task 6: Final verification

**Step 1: Full end-to-end test**

Open `demo/ascii-logo.html` and verify:
- [ ] Logo renders as recognizable termcanvas icon in ASCII
- [ ] Cursor blinks at ~530ms interval when mouse is still
- [ ] Moving mouse triggers smooth awakening transition (~500ms)
- [ ] Eye pupil smoothly tracks mouse position
- [ ] Stopping mouse for ~3s triggers smooth sleep transition
- [ ] Animation pauses when tab loses focus, resumes on focus
- [ ] Reduced motion preference shows static frame
- [ ] No console errors

**Step 2: Commit any final fixes**

```bash
git add demo/
git commit -m "feat(demo): finalize ASCII logo animation"
```
