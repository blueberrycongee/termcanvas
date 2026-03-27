# WelcomePopup Redesign: Auto-Play Narrative Demo

## Problem

The current WelcomePopup opens with a wall of text (welcome message, quick start steps, shortcuts, GitHub link) before dropping users into an interactive tutorial. Users are overwhelmed before they start, and the interactive steps require guessing what to do without visual demonstration first.

## Design

Replace the 6-step interactive tutorial with a 3-act auto-playing narrative animation followed by a shortcut card and CTA. Inspired by the Agentation HeroDemo pattern: setTimeout state machine, pure CSS transitions, no animation libraries.

## Narrative Structure

### Act 1 · Canvas (~3s)

4 terminal tiles fade in one by one onto the canvas (0.4s stagger). Each tile shows fake terminal content from existing TERMINALS data. Communicates: "this is a canvas with terminals on it."

Subtitle: "Terminals live on an infinite canvas · 终端在无限画布上"

### Act 2 · Focus (~3.5s)

A simulated cursor slides in from off-canvas → moves to a terminal title bar → double-click animation (two quick scale pulses on cursor) → that terminal zooms in and brightens, others shrink and dim → cursor moves into terminal → types a few characters.

Subtitle: "Double-click to focus · 双击聚焦"

### Act 3 · Navigate (~3s)

Focus auto-jumps to next terminal (slide transition) → jumps again → zooms back out to global view, all 4 terminals brighten simultaneously.

Subtitle: "Switch freely between terminals · 在终端间自由切换"

Total: ~10s per loop. Loops until user acts.

### CTA Panel

After one full loop completes, a CTA area fades in below the canvas:
- 3-5 key shortcuts (reuse existing shortcutItems)
- "Start" button (Enter to activate)
- Escape to dismiss at any time

## Implementation

### State Machine

```typescript
type Act = 1 | 2 | 3;
const [act, setAct] = useState<Act>(1);
const [phase, setPhase] = useState(0);
const [showCTA, setShowCTA] = useState(false);
const [loopCount, setLoopCount] = useState(0);
```

Each act is driven by a `useEffect` keyed on `[act, phase]` that uses `setTimeout` to advance to the next phase or act. No framer-motion needed.

### Visual Elements

- **Simulated cursor**: 12×12 SVG arrow, positioned with `transition: left 0.6s ease, top 0.6s ease`
- **Terminal tiles**: Reuse existing TERMINALS data and CELL_OFFSETS layout, remove all interaction handlers
- **Focus effect**: scale transform + opacity on non-focused tiles (existing approach)
- **Typing effect**: `typedText` state, setInterval at 80ms per character
- **Subtitles**: Centered below canvas, `<Bi>` component, fade on act change

### What to Keep

- Popup shell (title bar, backdrop, close button, Escape handler)
- `Bi` bilingual component
- `TERMINALS` data, `CELL_OFFSETS` layout constants
- Shortcut formatting from shortcutStore

### What to Remove

- Step 0 text wall (welcome text, quick start, GitHub link)
- Steps 1-4 interactive logic (double-click detection, shortcut detection, zoom/drag)
- Interactive state: `hasDoubleClicked`, `focusToggleCount`, `switchCount`, `hasInteractedZoom`
- `MiniCanvas` as interactive component (replaced by `DemoCanvas` render-only component)

### i18n

Replace existing welcome_*/onboarding_* keys with:
- `demo_subtitle_canvas` / `demo_subtitle_focus` / `demo_subtitle_navigate`
- `demo_cta_start`
- Keep `onboarding_skip` (Escape to skip)
