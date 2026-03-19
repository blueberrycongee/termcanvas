# Landing Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a visually striking single-page marketing site for TermCanvas with the ASCII logo animation as hero, product screenshot, features grid, and download CTA.

**Architecture:** Vanilla HTML/CSS/JS site built with Vite. Reuses the existing `demo/ascii-logo.js` animation engine. All content in a single `index.html` with inlined styles and one JS module. Deployed as static files to Vercel.

**Tech Stack:** Vite (vanilla template), HTML, CSS, JavaScript. No framework. Fonts via CDN (Geist + Geist Mono).

---

### Task 1: Scaffold Vite project in `website/`

**Files:**
- Create: `website/package.json`
- Create: `website/vite.config.js`
- Create: `website/index.html` (minimal shell)
- Create: `website/.gitignore`

**Step 1: Initialize the project**

```bash
cd /Users/zzzz/termcanvas
mkdir -p website/public
```

**Step 2: Create `website/package.json`**

```json
{
  "name": "termcanvas-website",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^6"
  }
}
```

**Step 3: Create `website/vite.config.js`**

```js
import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
});
```

**Step 4: Create `website/.gitignore`**

```
node_modules/
dist/
```

**Step 5: Create minimal `website/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TermCanvas — Your terminals, on an infinite canvas.</title>
  <link rel="icon" href="/icon.png" />
</head>
<body>
  <p>TermCanvas</p>
</body>
</html>
```

**Step 6: Copy assets into `website/public/`**

```bash
cp docs/icon.png website/public/icon.png
cp docs/image.png website/public/screenshot.png
```

**Step 7: Install dependencies and verify dev server starts**

```bash
cd website && npm install && npm run dev -- --port 4000 &
sleep 2 && curl -s http://localhost:4000 | head -5
kill %1
```

Expected: HTML output containing "TermCanvas"

**Step 8: Commit**

```bash
git add website/
git commit -m "feat(website): scaffold Vite project for landing page"
```

---

### Task 2: Copy ASCII animation and integrate into hero section

**Files:**
- Copy: `demo/ascii-logo.js` → `website/src/ascii-logo.js`
- Modify: `website/index.html`

**Step 1: Copy the animation script**

```bash
mkdir -p website/src
cp demo/ascii-logo.js website/src/ascii-logo.js
```

**Step 2: Modify the animation to export an `init` function instead of auto-running**

In `website/src/ascii-logo.js`, change the last line from `init();` to `export { init };`. Also change `document.getElementById("root")` to accept a container parameter:

Change function signature:
```js
function init(container) {
```

Change the line that appends the canvas:
```js
container.appendChild(displayCanvas);
```

And at the bottom, replace `init();` with:
```js
export { init };
```

**Step 3: Create `website/src/main.js` as the entry point**

```js
import { init } from "./ascii-logo.js";

const container = document.getElementById("ascii-logo");
if (container) init(container);
```

**Step 4: Update `website/index.html` to include hero structure**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TermCanvas — Your terminals, on an infinite canvas.</title>
  <link rel="icon" href="/icon.png" />
  <link rel="preconnect" href="https://cdn.jsdelivr.net" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1/dist/fonts/geist-sans/style.min.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1/dist/fonts/geist-mono/style.min.css" />
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
  <section id="hero">
    <div id="ascii-logo"></div>
    <h1>TermCanvas</h1>
    <p class="tagline">Your terminals, on an infinite canvas.</p>
    <div class="hero-buttons">
      <a href="https://github.com/blueberrycongee/termcanvas/releases" class="btn btn-primary">Download</a>
      <a href="https://github.com/blueberrycongee/termcanvas" class="btn btn-secondary">GitHub</a>
    </div>
    <div class="scroll-indicator">&#8595;</div>
  </section>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

**Step 5: Verify the animation renders**

```bash
cd website && npm run dev -- --port 4000
```

Open `http://localhost:4000` in browser. ASCII animation should render centered with title and buttons below.

**Step 6: Commit**

```bash
git add website/
git commit -m "feat(website): integrate ASCII logo animation into hero section"
```

---

### Task 3: Build the full page CSS

**Files:**
- Create: `website/src/style.css`

**Step 1: Write the complete stylesheet**

Key design tokens:
- Background: `#0a0a0a`
- Text primary: `#fafafa`
- Text secondary: `#71717a`
- Accent amber: `#e8b840`
- Accent blue: `#4090e0`
- Font body: `'Geist', sans-serif`
- Font mono: `'Geist Mono', monospace`

Sections:
- Reset and base styles (dark background, smooth scroll)
- Hero section (full viewport, flex column centered)
- Buttons (primary amber with glow, secondary outline)
- Scroll indicator (subtle bounce animation)
- Screenshot section (max-width contained, glow border)
- Features grid (responsive 2-col / 3-col)
- Bottom CTA
- Footer
- `prefers-reduced-motion` overrides
- Responsive breakpoints (mobile: stack to single column, reduce font sizes)

```css
/* ── Reset ──────────────────────────────────────────────────── */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  background: #0a0a0a;
  color: #fafafa;
  font-family: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

/* ── Hero ───────────────────────────────────────────────────── */
#hero {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 2rem;
}
#ascii-logo { display: flex; align-items: center; justify-content: center; }
#hero h1 {
  font-family: 'Geist Mono', monospace;
  font-size: 2rem;
  letter-spacing: 0.15em;
  margin-top: 1.5rem;
  font-weight: 600;
}
.tagline {
  color: #71717a;
  font-size: 1.1rem;
  margin-top: 0.5rem;
}
.hero-buttons {
  display: flex;
  gap: 1rem;
  margin-top: 2rem;
}

/* ── Buttons ────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 2rem;
  border-radius: 8px;
  font-family: 'Geist', sans-serif;
  font-size: 0.95rem;
  font-weight: 500;
  text-decoration: none;
  transition: all 0.2s ease;
  cursor: pointer;
}
.btn-primary {
  background: #e8b840;
  color: #0a0a0a;
  box-shadow: 0 0 20px rgba(232, 184, 64, 0.25);
}
.btn-primary:hover {
  background: #f0c850;
  box-shadow: 0 0 30px rgba(232, 184, 64, 0.4);
}
.btn-secondary {
  background: transparent;
  color: #fafafa;
  border: 1px solid #333;
}
.btn-secondary:hover {
  border-color: #555;
  background: rgba(255,255,255,0.05);
}

/* ── Scroll Indicator ───────────────────────────────────────── */
.scroll-indicator {
  position: absolute;
  bottom: 2rem;
  color: #71717a;
  font-size: 1.5rem;
  animation: bounce 2s ease infinite;
}
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(8px); }
}

/* ── Screenshot ─────────────────────────────────────────────── */
#screenshot {
  padding: 4rem 2rem;
  display: flex;
  justify-content: center;
}
#screenshot img {
  max-width: 1100px;
  width: 100%;
  border-radius: 12px;
  border: 1px solid #222;
  box-shadow: 0 0 60px rgba(232, 184, 64, 0.08), 0 0 120px rgba(64, 144, 224, 0.05);
}

/* ── Features ───────────────────────────────────────────────── */
#features {
  max-width: 960px;
  margin: 0 auto;
  padding: 4rem 2rem;
}
#features h2 {
  text-align: center;
  font-family: 'Geist Mono', monospace;
  font-size: 1.5rem;
  letter-spacing: 0.1em;
  margin-bottom: 3rem;
  color: #fafafa;
}
.features-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 2rem;
}
.feature-card {
  padding: 1.5rem;
  border-radius: 12px;
  background: #111;
  border: 1px solid #1a1a1a;
  transition: border-color 0.2s;
}
.feature-card:hover {
  border-color: #333;
}
.feature-icon {
  font-size: 1.5rem;
  margin-bottom: 0.75rem;
}
.feature-card h3 {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}
.feature-card p {
  color: #71717a;
  font-size: 0.9rem;
  line-height: 1.5;
}

/* ── Bottom CTA ─────────────────────────────────────────────── */
#cta {
  text-align: center;
  padding: 4rem 2rem;
}
#cta .hero-buttons { justify-content: center; }
.cta-sub {
  color: #71717a;
  font-size: 0.85rem;
  margin-top: 1rem;
}

/* ── Footer ─────────────────────────────────────────────────── */
footer {
  text-align: center;
  padding: 2rem;
  color: #3f3f46;
  font-size: 0.8rem;
  border-top: 1px solid #1a1a1a;
}
footer a { color: #71717a; text-decoration: none; }
footer a:hover { color: #fafafa; }

/* ── Responsive ─────────────────────────────────────────────── */
@media (max-width: 640px) {
  #hero h1 { font-size: 1.5rem; }
  .tagline { font-size: 0.95rem; }
  .features-grid { grid-template-columns: 1fr; }
  .hero-buttons { flex-direction: column; align-items: center; }
}

/* ── Reduced Motion ─────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .scroll-indicator { animation: none; }
  .btn { transition: none; }
  .feature-card { transition: none; }
}
```

**Step 2: Verify styles render correctly**

```bash
cd website && npm run dev -- --port 4000
```

Check hero section renders full-viewport dark with animation centered.

**Step 3: Commit**

```bash
git add website/src/style.css
git commit -m "feat(website): add complete landing page styles"
```

---

### Task 4: Add screenshot, features, CTA, and footer sections

**Files:**
- Modify: `website/index.html`

**Step 1: Add remaining sections to `index.html` after the hero `</section>`**

```html
  <section id="screenshot">
    <img src="/screenshot.png" alt="TermCanvas workspace with multiple AI agents" />
  </section>

  <section id="features">
    <h2>Features</h2>
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-icon">&#9633;</div>
        <h3>Infinite Canvas</h3>
        <p>Pan, zoom, and arrange your terminals freely on a spatial canvas. No more tabs or split panes.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#9678;</div>
        <h3>AI Agents</h3>
        <p>Run Claude Code, Codex, Gemini, Kimi, and OpenCode side by side. See their status at a glance.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#9654;</div>
        <h3>Composer</h3>
        <p>A unified input bar that sends prompts to the focused agent, with image paste support.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#9636;</div>
        <h3>Usage Tracking</h3>
        <p>Token cost dashboard with per-project and per-model breakdown. Know what you're spending.</p>
      </div>
    </div>
  </section>

  <section id="cta">
    <div class="hero-buttons">
      <a href="https://github.com/blueberrycongee/termcanvas/releases" class="btn btn-primary">Download</a>
      <a href="https://github.com/blueberrycongee/termcanvas" class="btn btn-secondary">GitHub</a>
    </div>
    <p class="cta-sub">MIT Licensed &middot; Open Source</p>
  </section>

  <footer>
    <a href="https://github.com/blueberrycongee/termcanvas">GitHub</a>
    &nbsp;&middot;&nbsp;
    <span>MIT License</span>
    &nbsp;&middot;&nbsp;
    <span>TermCanvas</span>
  </footer>
```

**Step 2: Verify full page**

Open `http://localhost:4000`, scroll through all sections. Check:
- Screenshot renders with glow border
- Features grid shows 2 columns on desktop, 1 on mobile
- Bottom CTA buttons work
- Footer is minimal

**Step 3: Commit**

```bash
git add website/index.html
git commit -m "feat(website): add screenshot, features, CTA, and footer sections"
```

---

### Task 5: Add meta tags and OG/social metadata

**Files:**
- Modify: `website/index.html` (head section)

**Step 1: Add meta and OG tags inside `<head>`**

```html
  <meta name="description" content="TermCanvas spreads all your terminals across an infinite spatial canvas. First-class support for AI coding agents." />
  <meta property="og:title" content="TermCanvas" />
  <meta property="og:description" content="Your terminals, on an infinite canvas." />
  <meta property="og:image" content="/screenshot.png" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="TermCanvas" />
  <meta name="twitter:description" content="Your terminals, on an infinite canvas." />
  <meta name="twitter:image" content="/screenshot.png" />
```

**Step 2: Commit**

```bash
git add website/index.html
git commit -m "feat(website): add OG and social meta tags"
```

---

### Task 6: Verify build and finalize

**Step 1: Run production build**

```bash
cd website && npm run build
```

Expected: `website/dist/` directory with `index.html`, assets, and images.

**Step 2: Preview production build**

```bash
cd website && npm run preview -- --port 4001
```

Open `http://localhost:4001`. Verify:
- ASCII animation loads and animates
- All sections render
- Buttons link correctly
- Responsive: resize to mobile width, features stack

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(website): landing page complete and build verified"
```
