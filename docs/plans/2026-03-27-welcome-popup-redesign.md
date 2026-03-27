# WelcomePopup Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 6-step interactive tutorial in WelcomePopup with a 3-act auto-playing narrative animation + CTA panel.

**Architecture:** Single-component rewrite of WelcomePopup.tsx. The animation uses an async/await + delay() state machine (Agentation HeroDemo pattern). A render-only DemoCanvas replaces the interactive MiniCanvas. Existing popup shell, Bi component, TERMINALS data, and CELL_OFFSETS are preserved.

**Tech Stack:** React useState/useEffect, CSS transitions, no animation libraries.

---

### Task 1: Add new i18n keys

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`

**Step 1: Add new keys to en.ts**

In `src/i18n/en.ts`, replace the `welcome_*` and `onboarding_*` keys (lines 360-385) with:

```typescript
  // Welcome demo
  welcome_title: "termcanvas",
  demo_subtitle_canvas: "Terminals live on an infinite canvas",
  demo_subtitle_focus: "Double-click to focus",
  demo_subtitle_navigate: "Switch freely between terminals",
  demo_cta_start: "Start",
  demo_skip: "Escape to skip",
```

**Step 2: Add new keys to zh.ts**

In `src/i18n/zh.ts`, replace the matching keys (lines 357-382) with:

```typescript
  // Welcome demo
  welcome_title: "termcanvas",
  demo_subtitle_canvas: "终端在无限画布上",
  demo_subtitle_focus: "双击聚焦",
  demo_subtitle_navigate: "在终端间自由切换",
  demo_cta_start: "开始",
  demo_skip: "Escape 跳过",
```

**Step 3: Verify no type errors**

Run: `cd /Users/zzzz/termcanvas && npx tsc --noEmit 2>&1 | head -20`

Note: This will show errors in WelcomePopup.tsx referencing removed keys — that's expected. We'll fix those in Task 2. Just confirm en.ts and zh.ts themselves have no syntax errors.

**Step 4: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh.ts
git commit -m "feat(i18n): replace welcome/onboarding keys with demo narrative keys"
```

---

### Task 2: Rewrite WelcomePopup — DemoCanvas + animation state machine

This is the main task. Replace everything inside WelcomePopup.tsx.

**Files:**
- Modify: `src/components/WelcomePopup.tsx`

**Step 1: Rewrite WelcomePopup.tsx**

Replace the entire file content. Keep these from the original:
- `Bi` component (lines 23-31)
- `TERMINALS` data (lines 33-68)
- `CELL_OFFSETS` constants (find in file — the 2x2 grid positions)

Remove entirely:
- `MiniCanvas` component and all its interaction handlers
- `TutorialStep` type and step 0-5 logic
- `hasDoubleClicked`, `focusToggleCount`, `switchCount`, `hasInteractedZoom` states
- `interpolateTemplate` helper
- All keyboard handler logic for interactive steps

Replace with this structure:

```typescript
import { useState, useEffect, useRef, useCallback } from "react";
import { en } from "../i18n/en";
import { zh } from "../i18n/zh";
import { useShortcutStore, formatShortcut } from "../stores/shortcutStore";

const isMac = (window.termcanvas?.app.platform ?? "darwin") === "darwin";

interface Props {
  onClose: () => void;
}

// Bilingual text component (kept from original)
function Bi({ en: enText, zh: zhText }: { en: string; zh: string }) {
  return (
    <>
      <span style={{ color: "var(--cyan)" }}>{enText}</span>
      <span className="text-[var(--text-faint)] mx-1">·</span>
      <span style={{ color: "var(--amber)" }}>{zhText}</span>
    </>
  );
}

// Terminal data (kept from original)
const TERMINALS = [
  {
    name: "node",
    color: "var(--cyan)",
    lines: [
      { text: "$ node server.js", color: "var(--text-muted)" },
      { text: "listening on :3000", color: "var(--green)" },
    ],
  },
  {
    name: "build",
    color: "var(--amber)",
    lines: [
      { text: "$ npm run build", color: "var(--text-muted)" },
      { text: "✓ built in 2.1s", color: "var(--green)" },
    ],
  },
  {
    name: "test",
    color: "var(--accent)",
    lines: [
      { text: "$ npm test", color: "var(--text-muted)" },
      { text: "PASS 42 tests", color: "var(--green)" },
    ],
  },
  {
    name: "git",
    color: "var(--text-secondary)",
    lines: [
      { text: "$ git log --oneline", color: "var(--text-muted)" },
      { text: "a1b2c3d fix: typo", color: "var(--text-primary)" },
    ],
  },
];

// 2x2 grid positions (center of 320x200 canvas area)
const CELL_W = 120;
const CELL_H = 80;
const GAP = 16;
const GRID_W = CELL_W * 2 + GAP;
const GRID_H = CELL_H * 2 + GAP;

const CELL_OFFSETS = [
  { x: 0, y: 0 },
  { x: CELL_W + GAP, y: 0 },
  { x: 0, y: CELL_H + GAP },
  { x: CELL_W + GAP, y: CELL_H + GAP },
];

// Canvas dimensions
const CANVAS_W = 320;
const CANVAS_H = 200;
const GRID_ORIGIN_X = (CANVAS_W - GRID_W) / 2;
const GRID_ORIGIN_Y = (CANVAS_H - GRID_H) / 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Act = 1 | 2 | 3;

export function WelcomePopup({ onClose }: Props) {
  const shortcuts = useShortcutStore((s) => s.shortcuts);

  // Animation state
  const [act, setAct] = useState<Act>(1);
  const [visibleTiles, setVisibleTiles] = useState<number[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [cursorClicking, setCursorClicking] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [showCTA, setShowCTA] = useState(false);
  const [subtitle, setSubtitle] = useState<{ en: string; zh: string } | null>(null);
  const cancelledRef = useRef(false);

  // Shortcut items for CTA panel
  const shortcutItems = [
    { key: shortcuts.clearFocus, en: "Focus / Unfocus", zh: "聚焦 / 取消聚焦" },
    { key: shortcuts.nextTerminal, en: "Next terminal", zh: "下一个终端" },
    { key: shortcuts.prevTerminal, en: "Previous terminal", zh: "上一个终端" },
  ];

  // --- Animation orchestrator ---
  useEffect(() => {
    cancelledRef.current = false;
    let typeInterval: ReturnType<typeof setInterval>;

    const cancelled = () => cancelledRef.current;

    const resetState = () => {
      setVisibleTiles([]);
      setFocusedIndex(-1);
      setCursorPos(null);
      setCursorClicking(false);
      setTypedText("");
      setSubtitle(null);
    };

    const typeText = (text: string, ms = 80): Promise<void> => {
      return new Promise((resolve) => {
        let i = 0;
        setTypedText("");
        typeInterval = setInterval(() => {
          if (cancelled()) {
            clearInterval(typeInterval);
            resolve();
            return;
          }
          i++;
          setTypedText(text.slice(0, i));
          if (i >= text.length) {
            clearInterval(typeInterval);
            resolve();
          }
        }, ms);
      });
    };

    const getTileCenterX = (index: number) =>
      GRID_ORIGIN_X + CELL_OFFSETS[index].x + CELL_W / 2;
    const getTileCenterY = (index: number) =>
      GRID_ORIGIN_Y + CELL_OFFSETS[index].y + CELL_H / 2;
    const getTileTitleY = (index: number) =>
      GRID_ORIGIN_Y + CELL_OFFSETS[index].y + 8;

    const runAnimation = async () => {
      // === ACT 1: Canvas — tiles fade in ===
      resetState();
      setAct(1);
      setSubtitle({ en: en.demo_subtitle_canvas, zh: zh.demo_subtitle_canvas });

      await delay(400);

      // Stagger tile appearance
      for (let i = 0; i < 4; i++) {
        if (cancelled()) return;
        setVisibleTiles((prev) => [...prev, i]);
        await delay(400);
      }

      await delay(1200);
      if (cancelled()) return;

      // === ACT 2: Focus — cursor enters, double-clicks, types ===
      setAct(2);
      setSubtitle({ en: en.demo_subtitle_focus, zh: zh.demo_subtitle_focus });

      // Cursor enters from right
      setCursorPos({ x: CANVAS_W + 10, y: CANVAS_H / 2 });
      await delay(100);
      if (cancelled()) return;

      // Move cursor to first terminal title bar
      setCursorPos({ x: getTileCenterX(0), y: getTileTitleY(0) });
      await delay(700);
      if (cancelled()) return;

      // Double-click animation
      setCursorClicking(true);
      await delay(120);
      setCursorClicking(false);
      await delay(100);
      setCursorClicking(true);
      await delay(120);
      setCursorClicking(false);
      await delay(200);
      if (cancelled()) return;

      // Focus terminal 0
      setFocusedIndex(0);
      await delay(500);
      if (cancelled()) return;

      // Move cursor into terminal and type
      setCursorPos({ x: getTileCenterX(0), y: getTileCenterY(0) + 10 });
      await delay(400);
      if (cancelled()) return;

      await typeText("npm start");
      await delay(800);
      if (cancelled()) return;

      // === ACT 3: Navigate — switch terminals, zoom out ===
      setAct(3);
      setSubtitle({ en: en.demo_subtitle_navigate, zh: zh.demo_subtitle_navigate });
      setTypedText("");
      setCursorPos(null); // hide cursor during navigation

      await delay(400);
      if (cancelled()) return;

      // Jump to terminal 1
      setFocusedIndex(1);
      await delay(800);
      if (cancelled()) return;

      // Jump to terminal 2
      setFocusedIndex(2);
      await delay(800);
      if (cancelled()) return;

      // Zoom out — unfocus all
      setFocusedIndex(-1);
      await delay(1500);
      if (cancelled()) return;

      // Show CTA after first complete loop
      setShowCTA(true);

      // Wait then loop
      await delay(3000);
      if (cancelled()) return;

      // Loop
      runAnimation();
    };

    runAnimation();

    return () => {
      cancelledRef.current = true;
      clearInterval(typeInterval);
    };
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Enter" && showCTA) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, showCTA]);

  // Compute transform for focus zoom effect
  const getTransform = () => {
    if (focusedIndex < 0) return { x: 0, y: 0, scale: 1 };
    const offset = CELL_OFFSETS[focusedIndex];
    const centerX = offset.x + CELL_W / 2;
    const centerY = offset.y + CELL_H / 2;
    const gridCenterX = GRID_W / 2;
    const gridCenterY = GRID_H / 2;
    return {
      x: (gridCenterX - centerX) * 0.5,
      y: (gridCenterY - centerY) * 0.5,
      scale: 1.3,
    };
  };

  const transform = getTransform();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.6)" }}
    >
      <div
        className="flex flex-col rounded-lg overflow-hidden shadow-lg"
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
          width: 380,
          maxHeight: "80vh",
        }}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
          <span className="text-[12px] font-medium text-[var(--text-primary)]">
            {en.welcome_title}
          </span>
          <button
            className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={onClose}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M2 2L8 8M8 2L2 8"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Demo canvas */}
        <div className="px-4 pt-4 pb-2">
          <div
            style={{
              position: "relative",
              width: CANVAS_W,
              height: CANVAS_H,
              margin: "0 auto",
              overflow: "hidden",
              borderRadius: 8,
              backgroundColor: "var(--surface-raised, var(--bg-secondary))",
              border: "1px solid var(--border)",
            }}
          >
            {/* Grid container with zoom transform */}
            <div
              style={{
                position: "absolute",
                left: GRID_ORIGIN_X,
                top: GRID_ORIGIN_Y,
                width: GRID_W,
                height: GRID_H,
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                transformOrigin: "center center",
                transition: "transform 0.5s ease",
              }}
            >
              {TERMINALS.map((term, i) => {
                const offset = CELL_OFFSETS[i];
                const isVisible = visibleTiles.includes(i);
                const isFocused = focusedIndex === i;
                const isDimmed = focusedIndex >= 0 && !isFocused;

                return (
                  <div
                    key={term.name}
                    style={{
                      position: "absolute",
                      left: offset.x,
                      top: offset.y,
                      width: CELL_W,
                      height: CELL_H,
                      borderRadius: 6,
                      backgroundColor: "var(--surface)",
                      border: `1px solid ${isFocused ? term.color : "var(--border)"}`,
                      overflow: "hidden",
                      opacity: isVisible ? (isDimmed ? 0.3 : 1) : 0,
                      transform: isVisible ? "scale(1)" : "scale(0.9)",
                      transition: "opacity 0.4s ease, transform 0.4s ease, border-color 0.3s ease",
                    }}
                  >
                    {/* Title bar */}
                    <div
                      style={{
                        padding: "3px 6px",
                        borderBottom: "1px solid var(--border)",
                        fontSize: 8,
                        fontWeight: 600,
                        color: term.color,
                        backgroundColor: "var(--surface)",
                      }}
                    >
                      {term.name}
                    </div>
                    {/* Terminal content */}
                    <div style={{ padding: "4px 6px" }}>
                      {term.lines.map((line, li) => (
                        <div
                          key={li}
                          style={{
                            fontSize: 7,
                            fontFamily: "monospace",
                            color: line.color,
                            lineHeight: 1.5,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {line.text}
                        </div>
                      ))}
                      {/* Typed text only in focused terminal during act 2 */}
                      {isFocused && act === 2 && typedText && (
                        <div
                          style={{
                            fontSize: 7,
                            fontFamily: "monospace",
                            color: "var(--text-primary)",
                            lineHeight: 1.5,
                          }}
                        >
                          $ {typedText}
                          <span
                            style={{
                              display: "inline-block",
                              width: 4,
                              height: 9,
                              backgroundColor: "var(--text-primary)",
                              marginLeft: 1,
                              animation: "blink 1s step-end infinite",
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Simulated cursor */}
            {cursorPos && (
              <svg
                width="12"
                height="16"
                viewBox="0 0 12 16"
                style={{
                  position: "absolute",
                  left: cursorPos.x,
                  top: cursorPos.y,
                  transition: "left 0.6s ease, top 0.6s ease",
                  transform: cursorClicking ? "scale(0.8)" : "scale(1)",
                  pointerEvents: "none",
                  zIndex: 10,
                  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
                }}
              >
                <path
                  d="M0 0L0 12L3.5 9L6.5 15L8.5 14L5.5 8L10 8Z"
                  fill="white"
                  stroke="var(--text-primary)"
                  strokeWidth="0.8"
                />
              </svg>
            )}
          </div>

          {/* Subtitle */}
          <div
            className="text-center mt-2"
            style={{
              minHeight: 20,
              transition: "opacity 0.3s ease",
              opacity: subtitle ? 1 : 0,
            }}
          >
            {subtitle && (
              <span className="text-[11px]">
                <Bi en={subtitle.en} zh={subtitle.zh} />
              </span>
            )}
          </div>
        </div>

        {/* CTA panel */}
        <div
          className="px-4 pb-4"
          style={{
            opacity: showCTA ? 1 : 0,
            transform: showCTA ? "translateY(0)" : "translateY(8px)",
            transition: "opacity 0.4s ease, transform 0.4s ease",
            pointerEvents: showCTA ? "auto" : "none",
          }}
        >
          <div className="border-t border-[var(--border)] pt-3 mt-1">
            {/* Key shortcuts */}
            <div className="space-y-1 mb-3">
              {shortcutItems.map((item) => (
                <div key={item.en} className="flex gap-2 text-[11px]">
                  <span className="text-[var(--accent)] shrink-0">
                    {formatShortcut(item.key, isMac)}
                  </span>
                  <span>
                    <Bi en={item.en} zh={item.zh} />
                  </span>
                </div>
              ))}
            </div>

            {/* Start button */}
            <button
              className="w-full py-1.5 rounded-md text-[12px] font-medium transition-colors duration-150"
              style={{
                backgroundColor: "var(--accent)",
                color: "var(--surface)",
              }}
              onClick={onClose}
            >
              <Bi en={en.demo_cta_start} zh={zh.demo_cta_start} />
            </button>

            <div className="text-center mt-1.5 text-[10px] text-[var(--text-faint)]">
              <Bi en={en.demo_skip} zh={zh.demo_skip} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add CSS blink keyframe**

Check if a blink animation already exists in the project. If not, add to the global CSS (likely `src/index.css` or similar):

```css
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
```

**Step 3: Verify no type errors**

Run: `cd /Users/zzzz/termcanvas && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/components/WelcomePopup.tsx src/index.css  # or whichever CSS file was touched
git commit -m "feat(welcome): rewrite popup as auto-playing narrative demo"
```

---

### Task 3: Clean up unused i18n keys

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`

**Step 1: Remove dead keys**

Grep for any remaining references to old keys. Remove from both en.ts and zh.ts:
- `welcome_heading`, `welcome_desc`, `welcome_quick_start`, `welcome_step_1/2/3`
- `welcome_shortcuts`, `welcome_github`, `welcome_dismiss`
- `onboarding_dblclick_prompt`, `onboarding_focus_prompt`, `onboarding_unfocus_prompt`
- `onboarding_switch_prompt`, `onboarding_switch_continue`
- `onboarding_zoom_prompt`, `onboarding_zoom_continue`
- `onboarding_complete`, `onboarding_complete_dismiss`, `onboarding_skip`

Only remove keys that are confirmed unreferenced (grep to verify).

**Step 2: Verify no type errors**

Run: `cd /Users/zzzz/termcanvas && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh.ts
git commit -m "chore(i18n): remove unused welcome/onboarding keys"
```

---

### Task 4: Visual QA and timing tuning

**Files:**
- Possibly modify: `src/components/WelcomePopup.tsx` (timing values only)

**Step 1: Run the dev app and trigger the welcome popup**

Launch the app and open/reset the welcome popup. Watch the animation loop through once.

**Step 2: Check visual quality**

Verify:
- Tiles fade in smoothly with stagger
- Cursor movement is smooth, not jerky
- Double-click pulse is visible
- Focus zoom effect looks natural
- Terminal-switch transitions are clear
- Zoom-out at end of Act 3 feels like a "reset"
- Subtitle text is readable and transitions cleanly
- CTA panel fades in after first loop
- Escape and Enter both close the popup

**Step 3: Tune timing if needed**

Adjust delay values in the animation sequence. Key tuning points:
- Tile stagger delay (currently 400ms)
- Cursor travel time (CSS transition 0.6s)
- Dwell time after focus (currently 500ms)
- Typing speed (currently 80ms per char)
- Navigation dwell time (currently 800ms)
- Post-loop wait before re-looping (currently 3000ms)

**Step 4: Commit any tuning changes**

```bash
git add src/components/WelcomePopup.tsx
git commit -m "fix(welcome): tune demo animation timing"
```
