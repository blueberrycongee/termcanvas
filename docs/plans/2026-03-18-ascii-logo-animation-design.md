# ASCII Logo Animation Component Design

## Goal

Create a standalone ASCII art animation component that renders the termcanvas logo using density characters, with an interactive "eye" that awakens when the mouse moves and tracks the cursor.

## Style

Density character rendering (`" .:-=+*#%@$"`), hacker aesthetic. The logo's dark regions (terminal frame) map to high-density characters, light regions (background, screen) map to spaces/low-density.

## Architecture

### Rendering Pipeline

Each frame (driven by `requestAnimationFrame`):

1. Clear an OffscreenCanvas
2. Draw logo shapes (outer rounded rect, terminal frame, inner screen)
3. Draw cursor or eye depending on current state
4. `getImageData` → sample brightness per character cell
5. Map brightness to density character ramp
6. Update `<pre>` text content

Grid size: ~80 cols × 40 rows. Performance is not a concern at this resolution.

### State Machine

```
IDLE (cursor blink, ~530ms interval)
  → mouse move → AWAKENING (~500ms transition)
    → complete → TRACKING (pupil follows mouse with lerp smoothing)
      → mouse idle 3s → SLEEPING (~500ms transition)
        → complete → IDLE
```

### Eye Behavior

- **IDLE**: Center vertical bar rectangle, toggling opacity for blink effect
- **AWAKENING**: Vertical bar expands horizontally into ellipse via interpolation, circular pupil appears inside
- **TRACKING**: Elliptical eye socket fixed, pupil position = eye center + normalized(mouse direction) × max offset, smoothed with lerp (not instant snap)
- **SLEEPING**: Reverse of awakening, ellipse contracts back to vertical bar

### Mouse Interaction

- Lazy follow: cursor blink by default, mouse movement triggers awakening
- Pupil direction: computed from mouse position relative to logo center, normalized and clamped
- Return to idle: 3 seconds after last mouse movement

## Component Interface

```typescript
interface AsciiLogoProps {
  cols?: number;        // default 80
  rows?: number;        // default 40
  className?: string;
  fontSize?: string;    // CSS font-size, default "12px"
}
```

Standalone React component `<AsciiLogo />`. No external dependencies beyond React.

## Demo Page

`demo/ascii-logo.html` — minimal standalone HTML file with dark background, centered `<AsciiLogo />`. Independent from main app build pipeline.

## Approach

Canvas-based real-time rendering (not pre-baked frames). This gives smooth continuous pupil tracking and fluid awakening/sleeping transitions, which discrete pre-rendered frames cannot achieve well with mouse interaction.
