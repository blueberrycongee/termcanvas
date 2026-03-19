# Landing Page Design

## Goal

A visually striking single-page marketing site for TermCanvas. Primary objective: attract users to download the app. Pure showcase — aesthetics first.

## Tech Stack

- Vanilla HTML / CSS / JS with Vite build
- No framework (React, etc.) — unnecessary for a single showcase page
- Lives in `website/` directory within the main repo
- Deploys to Vercel (root directory set to `website/`)

## Visual Direction

- Full dark theme (`#0a0a0a` background) — matches the product UI and ASCII animation
- Font: Geist + Geist Mono (consistent with the app)
- Accent color: amber/gold from the logo frame (`#e8b840`) and blue from the eye (`#4090e0`)
- Subtle gradients and glows, no flat blocks
- Smooth scroll, minimal motion (respects `prefers-reduced-motion`)

## Page Structure

### 1. Hero (full viewport)

- ASCII logo animation centered (reuse `demo/ascii-logo.js` directly)
- "TermCanvas" title below the animation (Geist Mono, letter-spaced)
- Tagline: "Your terminals, on an infinite canvas."
- Two buttons: "Download" (primary, amber) + "GitHub" (secondary, outline)
- Subtle scroll indicator at bottom

### 2. Product Screenshot

- Full-width `docs/image.png` with a soft glow border or gradient fade at edges
- Brief caption or no caption — the image speaks for itself

### 3. Features Grid

Core selling points in a 2×2 or 3-column grid:

1. **Infinite Canvas** — pan, zoom, arrange terminals freely
2. **AI Agents** — Claude Code, Codex, Gemini, Kimi, OpenCode side by side
3. **Composer** — unified input bar to talk to the focused agent
4. **Usage Tracking** — token cost dashboard with per-project breakdown

Each feature: icon/emoji + title + one-line description. Keep it minimal.

### 4. Bottom CTA

- Repeat download button + GitHub star link
- "MIT Licensed · Open Source"

### 5. Footer

- Minimal: GitHub link, license
- No excessive links or nav

## Assets

- ASCII animation: copy `demo/ascii-logo.js` into `website/`
- Product screenshot: reference `docs/image.png` (copy into website build)
- App icon: reference `docs/icon.png`
- Fonts: load Geist + Geist Mono from CDN or bundle

## Deployment

- Vercel project pointing to `website/` as root directory
- Single `npm run build` produces static output in `website/dist/`
- No SSR, no API routes, pure static
