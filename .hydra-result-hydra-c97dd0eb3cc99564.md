# Hydra Result: Completion Glow Design Recommendation

## Files changed
None — read-only analysis task.

## Analysis

### The problem
The current glow uses `rgba(59,130,246,0.12)` (Tailwind blue-500 at 12% opacity). On light bg `#eae8e4`, a 12% blue wash over warm beige produces a noticeable cool shift — visible. On dark bg `#101010`, 12% of any mid-brightness color over near-black is ≈ `rgb(7,16,30)` — indistinguishable from `#101010`. The glow is functionally invisible in dark mode.

### Why a single opacity can't work for both themes
The glow's job is to create a *perceived luminance delta* against the background. Against dark backgrounds, even a vivid color at low opacity produces almost no luminance contrast. Against light backgrounds, the same overlay is easily visible because the base luminance is already high and any tint stands out. You need asymmetric intensity: higher opacity on dark, lower on light.

---

## Recommendations

### 1. Aesthetic rationale
The glow is a **peripheral ambient cue**, not a call-to-action. It should be noticed in peripheral vision without demanding attention. The right model is "ambient light bleed from the screen edge" — soft, diffuse, one-directional gradient. It should feel like information ("something completed over there"), not like an alert or error.

### 2. Keep accent/blue semantics — do not shift color
`completed` already maps to `var(--accent)` in `STATUS_COLOR`. The glow should use the same semantic token so the color automatically adapts between dark (`#0070f3`) and light (`#2563eb`) themes. This keeps the completion signal consistent: the sidebar dot and the edge glow share the same hue. Do **not** shift to green, cyan, or any other color — `--accent` is established as the completion color in this app.

### 3. Relative intensity: dark ≈ 0.18–0.22, light ≈ 0.08–0.10
Concrete values using `var(--accent)`:

| Theme | Background | Accent | Glow opacity | Gradient |
|-------|-----------|--------|-------------|----------|
| Dark  | `#101010` | `#0070f3` | **0.20** | `linear-gradient(to right, color-mix(in srgb, var(--accent) 20%, transparent), transparent)` |
| Light | `#eae8e4` | `#2563eb` | **0.09** | same expression with 9% |

The simplest implementation: define a `--glow-alpha` token per theme.

```css
:root, [data-theme="dark"]  { --glow-alpha: 0.20; }
[data-theme="light"]        { --glow-alpha: 0.09; }
```

Then in the component, use `var(--accent)` with the alpha channel set via `color-mix` or by resolving to an `rgba()` in JS. Since the current code uses inline `style`, the easiest path is:

```tsx
background: `linear-gradient(to right, color-mix(in srgb, var(--accent) ${glowPct}%, transparent), transparent)`
```

where `glowPct` is read from a CSS custom property or toggled by a `data-theme` check. Alternatively, define a single CSS custom property `--completion-glow` as the full gradient color in each theme block and reference it directly.

### 4. Secondary hairline: yes, subtle, 1px
Add a 1px vertical line at the outer edge of the gradient (the screen edge side) using `var(--accent)` at ~35% opacity in dark mode, ~15% in light mode. This gives the glow a "source" — it reads as light bleeding from an edge rather than a floating haze. Without it, the soft gradient alone can feel vague/indeterminate, especially in dark mode where the gradient feathers into blackness quickly.

Implementation: a `border-left: 1px solid` (or `border-right`) on the glow divs, using `color-mix(in srgb, var(--accent) var(--glow-hairline-alpha), transparent)`.

```css
:root, [data-theme="dark"]  { --glow-hairline-alpha: 35%; }
[data-theme="light"]        { --glow-hairline-alpha: 15%; }
```

### 5. Preferred CSS-ready token scheme

Add to `src/index.css`:

```css
:root, [data-theme="dark"] {
  /* ... existing tokens ... */
  --completion-glow: color-mix(in srgb, var(--accent) 20%, transparent);
  --completion-glow-edge: color-mix(in srgb, var(--accent) 35%, transparent);
}

[data-theme="light"] {
  /* ... existing tokens ... */
  --completion-glow: color-mix(in srgb, var(--accent) 9%, transparent);
  --completion-glow-edge: color-mix(in srgb, var(--accent) 15%, transparent);
}
```

Component usage:

```tsx
style={{
  background: "linear-gradient(to right, var(--completion-glow), transparent)",
  borderLeft: "1px solid var(--completion-glow-edge)",
}}
```

This eliminates all hardcoded colors from the component, auto-adapts to theme, and follows the existing token pattern in `index.css`.

### 6. Design risks to avoid

- **Do not use `--red` or warm tones.** The app uses `--red` for error status. Any red/orange glow will be read as "something broke."
- **Do not use `--cyan`.** Cyan means `running`/`active`/`success` in `STATUS_COLOR`. An edge glow in cyan says "something is still running" — wrong signal.
- **Do not animate the glow (pulsing, breathing).** The `.status-pulse` animation is reserved for active/running states. A pulsing edge glow would read as "in progress," not "completed." The static glow with a fade-in transition is correct.
- **Do not exceed 0.25 opacity in dark mode.** Beyond that, the glow competes with the terminal content and reads as a selection highlight or focus indicator. The glow should be peripheral, not focal.
- **Do not use `box-shadow` as the glow mechanism.** Box shadows render on all four sides (or require clip hacks) and don't feather directionally. The current `linear-gradient` approach is correct.
- **Do not widen beyond 60px.** Wider glows intrude on terminal content. The current 60px width is appropriate — it stays in the dead zone between terminal tiles and the window edge.
- **Do not confuse with focus.** The focused terminal already uses `border-color: var(--accent)` via `WorktreeContainer`. The glow's lower intensity (0.20 vs solid accent border) and positional difference (screen edge vs tile border) keep them distinguishable. If focus ever gains an outer glow, the completion glow should be differentiated by using a narrower width or a different gradient curve (e.g., ease-out vs linear falloff).

## Tests
N/A — read-only task.

## Unresolved problems
None.
