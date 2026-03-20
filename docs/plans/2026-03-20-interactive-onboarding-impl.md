# Interactive Onboarding Tutorial Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the WelcomePopup from a single text page into a multi-step interactive tutorial with a mini canvas where users learn core shortcuts (focus, switch terminals, zoom/pan).

**Architecture:** Single component state machine inside the existing `WelcomePopup.tsx`. Step 0 = existing text page. Steps 1-4 = interactive mini canvas with fake terminal blocks. All keyboard events are captured and prevented from reaching the real app during tutorial steps. New i18n strings added for each step's prompt text.

**Tech Stack:** React (useState, useEffect, useRef, useCallback), CSS transforms for zoom/pan, existing `matchesShortcut` and `formatShortcut` from shortcutStore, existing `Bi` bilingual component.

---

### Task 1: Add i18n strings for tutorial steps

**Files:**
- Modify: `src/i18n/en.ts:223-233`
- Modify: `src/i18n/zh.ts:221-231`

**Step 1: Add English strings**

In `src/i18n/en.ts`, replace the existing welcome section (lines 223-233) with:

```ts
  // Welcome popup
  welcome_title: "termcanvas",
  welcome_heading: "Welcome to TermCanvas!",
  welcome_desc: "Manage terminals on an infinite canvas.",
  welcome_quick_start: "Quick Start:",
  welcome_step_1: "Click \"Add Project\" to add a project",
  welcome_step_2: "Open terminals in your worktrees",
  welcome_step_3: "Pan & zoom the canvas freely",
  welcome_shortcuts: "Key Shortcuts:",
  welcome_github: "GitHub:",
  welcome_dismiss: "Press Enter to start the interactive tutorial, or Escape to skip.",

  // Onboarding tutorial
  onboarding_focus_prompt: "Press {shortcut} to focus a terminal",
  onboarding_switch_prompt: "Press {next} / {prev} to switch terminals",
  onboarding_switch_continue: "Press Enter to continue",
  onboarding_zoom_prompt: "Scroll to zoom, drag to pan",
  onboarding_zoom_continue: "Press Enter to continue",
  onboarding_complete: "Ready! Press {shortcut} to add your first project.",
  onboarding_complete_dismiss: "Press Enter or Escape to close.",
  onboarding_skip: "Escape to skip",
```

**Step 2: Add Chinese strings**

In `src/i18n/zh.ts`, replace the existing welcome section (lines 221-231) with:

```ts
  // Welcome popup
  welcome_title: "termcanvas",
  welcome_heading: "欢迎使用 TermCanvas！",
  welcome_desc: "在无限画布上管理终端。",
  welcome_quick_start: "快速开始：",
  welcome_step_1: "点击「Add Project」添加项目",
  welcome_step_2: "在工作树中打开终端",
  welcome_step_3: "自由平移和缩放画布",
  welcome_shortcuts: "快捷键：",
  welcome_github: "GitHub:",
  welcome_dismiss: "按 Enter 进入交互教程，按 Escape 跳过。",

  // Onboarding tutorial
  onboarding_focus_prompt: "按 {shortcut} 聚焦终端",
  onboarding_switch_prompt: "按 {next} / {prev} 切换终端",
  onboarding_switch_continue: "按 Enter 继续",
  onboarding_zoom_prompt: "滚轮缩放，拖拽平移",
  onboarding_zoom_continue: "按 Enter 继续",
  onboarding_complete: "准备好了！按 {shortcut} 添加你的第一个项目。",
  onboarding_complete_dismiss: "按 Enter 或 Escape 关闭。",
  onboarding_skip: "Escape 跳过",
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors (both objects share the same shape via `TranslationKey` type)

**Step 4: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh.ts
git commit -m "feat(onboarding): add i18n strings for interactive tutorial steps"
```

---

### Task 2: Add unit tests for tutorial state machine logic

**Files:**
- Create: `tests/onboarding-tutorial.test.ts`

**Step 1: Write the tests**

These tests validate the pure logic that will drive the tutorial. We define the state machine types and transitions as pure functions, then test them.

```ts
import test from "node:test";
import assert from "node:assert/strict";

/**
 * Mirror the state machine types from WelcomePopup.
 * Steps: 0=text, 1=focus, 2=switch, 3=zoom, 4=complete
 */
type TutorialStep = 0 | 1 | 2 | 3 | 4;

interface TutorialState {
  step: TutorialStep;
  focusedIndex: number;     // -1 = none focused
  switchCount: number;
  hasInteractedZoom: boolean;
}

const TERMINAL_COUNT = 4;

function initialState(): TutorialState {
  return { step: 0, focusedIndex: -1, switchCount: 0, hasInteractedZoom: false };
}

function handleEnter(state: TutorialState): TutorialState {
  if (state.step === 0) return { ...state, step: 1 };
  if (state.step === 2 && state.switchCount >= 2) return { ...state, step: 3 };
  if (state.step === 3 && state.hasInteractedZoom) return { ...state, step: 4 };
  if (state.step === 4) return state; // close handled externally
  return state;
}

function handleFocus(state: TutorialState): TutorialState {
  if (state.step !== 1) return state;
  return { ...state, step: 2, focusedIndex: 0 };
}

function handleNextTerminal(state: TutorialState): TutorialState {
  if (state.step !== 2) return state;
  const next = (state.focusedIndex + 1) % TERMINAL_COUNT;
  return { ...state, focusedIndex: next, switchCount: state.switchCount + 1 };
}

function handlePrevTerminal(state: TutorialState): TutorialState {
  if (state.step !== 2) return state;
  const prev = (state.focusedIndex - 1 + TERMINAL_COUNT) % TERMINAL_COUNT;
  return { ...state, focusedIndex: prev, switchCount: state.switchCount + 1 };
}

function handleZoomOrPan(state: TutorialState): TutorialState {
  if (state.step !== 3) return state;
  return { ...state, hasInteractedZoom: true };
}

// --- Tests ---

test("step 0 → Enter advances to step 1", () => {
  const s = handleEnter(initialState());
  assert.equal(s.step, 1);
});

test("step 1 → focus advances to step 2 with focusedIndex 0", () => {
  let s = initialState();
  s = handleEnter(s); // step 1
  s = handleFocus(s);
  assert.equal(s.step, 2);
  assert.equal(s.focusedIndex, 0);
});

test("step 2 → next terminal wraps around", () => {
  let s: TutorialState = { step: 2, focusedIndex: 3, switchCount: 0, hasInteractedZoom: false };
  s = handleNextTerminal(s);
  assert.equal(s.focusedIndex, 0);
  assert.equal(s.switchCount, 1);
});

test("step 2 → prev terminal wraps around", () => {
  let s: TutorialState = { step: 2, focusedIndex: 0, switchCount: 0, hasInteractedZoom: false };
  s = handlePrevTerminal(s);
  assert.equal(s.focusedIndex, 3);
  assert.equal(s.switchCount, 1);
});

test("step 2 → Enter does nothing until switchCount >= 2", () => {
  let s: TutorialState = { step: 2, focusedIndex: 1, switchCount: 1, hasInteractedZoom: false };
  s = handleEnter(s);
  assert.equal(s.step, 2);

  s = { ...s, switchCount: 2 };
  s = handleEnter(s);
  assert.equal(s.step, 3);
});

test("step 3 → zoom interaction enables Enter to advance", () => {
  let s: TutorialState = { step: 3, focusedIndex: 1, switchCount: 2, hasInteractedZoom: false };
  s = handleEnter(s);
  assert.equal(s.step, 3); // no interaction yet

  s = handleZoomOrPan(s);
  assert.ok(s.hasInteractedZoom);

  s = handleEnter(s);
  assert.equal(s.step, 4);
});

test("focus/switch/zoom actions are ignored on wrong steps", () => {
  const s0 = initialState();
  assert.equal(handleFocus(s0).step, 0);
  assert.equal(handleNextTerminal(s0).focusedIndex, -1);
  assert.equal(handleZoomOrPan(s0).hasInteractedZoom, false);

  const s4: TutorialState = { step: 4, focusedIndex: 1, switchCount: 3, hasInteractedZoom: true };
  assert.equal(handleNextTerminal(s4).focusedIndex, 1);
});
```

**Step 2: Run the tests**

Run: `npx tsx --test tests/onboarding-tutorial.test.ts`
Expected: All 7 tests pass.

**Step 3: Commit**

```bash
git add tests/onboarding-tutorial.test.ts
git commit -m "test(onboarding): add state machine unit tests for tutorial flow"
```

---

### Task 3: Rewrite WelcomePopup with tutorial state machine

**Files:**
- Modify: `src/components/WelcomePopup.tsx` (full rewrite)

This is the main task. The component keeps its existing text page (step 0) and adds steps 1-4 with the mini canvas.

**Step 1: Write the full component**

Rewrite `src/components/WelcomePopup.tsx` with the following content:

```tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { en } from "../i18n/en";
import { zh } from "../i18n/zh";
import {
  useShortcutStore,
  formatShortcut,
  matchesShortcut,
} from "../stores/shortcutStore";

const isMac = (window.termcanvas?.app.platform ?? "darwin") === "darwin";

interface Props {
  onClose: () => void;
}

function Bi({ en: enText, zh: zhText }: { en: string; zh: string }) {
  return (
    <>
      <span style={{ color: "var(--cyan)" }}>{enText}</span>
      <span className="text-[var(--text-faint)] mx-1">·</span>
      <span style={{ color: "var(--amber)" }}>{zhText}</span>
    </>
  );
}

// --- Fake terminal data ---
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
      { text: "✓ built in 1.2s", color: "var(--green)" },
    ],
  },
  {
    name: "git",
    color: "var(--cyan)",
    lines: [
      { text: "$ git status", color: "var(--text-muted)" },
      { text: "nothing to commit", color: "var(--text-secondary)" },
    ],
  },
  {
    name: "test",
    color: "var(--green)",
    lines: [
      { text: "$ npm test", color: "var(--text-muted)" },
      { text: "4 passing (12ms)", color: "var(--green)" },
    ],
  },
];

type TutorialStep = 0 | 1 | 2 | 3 | 4;

function replaceToken(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

// --- Mini canvas sub-component ---
function MiniCanvas({
  focusedIndex,
  step,
  onZoomOrPan,
}: {
  focusedIndex: number;
  step: TutorialStep;
  onZoomOrPan: () => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (step !== 3) return;
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setTransform((t) => ({
        ...t,
        scale: Math.max(0.5, Math.min(2, t.scale + delta)),
      }));
      onZoomOrPan();
    },
    [step, onZoomOrPan],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (step !== 3) return;
      dragging.current = true;
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        tx: transform.x,
        ty: transform.y,
      };
    },
    [step, transform.x, transform.y],
  );

  useEffect(() => {
    if (step !== 3) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setTransform((t) => ({
        ...t,
        x: dragStart.current.tx + dx,
        y: dragStart.current.ty + dy,
      }));
      onZoomOrPan();
    };
    const handleMouseUp = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [step, onZoomOrPan]);

  return (
    <div
      ref={canvasRef}
      className="relative rounded bg-[var(--bg-secondary)] overflow-hidden select-none"
      style={{
        height: 220,
        cursor: step === 3 ? (dragging.current ? "grabbing" : "grab") : "default",
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transition: dragging.current ? "none" : "transform 150ms ease-out",
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          {TERMINALS.map((term, i) => (
            <div
              key={term.name}
              className="rounded border transition-all duration-200"
              style={{
                width: 120,
                height: 80,
                borderColor:
                  focusedIndex === i
                    ? "rgba(0,112,243,0.6)"
                    : "var(--border)",
                boxShadow:
                  focusedIndex === i
                    ? "0 0 12px rgba(0,112,243,0.45)"
                    : "none",
                background: "var(--bg)",
              }}
            >
              {/* Title bar */}
              <div className="flex items-center gap-1 px-1.5 py-0.5 border-b border-[var(--border)]">
                <div
                  className="w-[3px] h-[7px] rounded-full shrink-0"
                  style={{ background: term.color }}
                />
                <span className="text-[9px] text-[var(--text-secondary)] truncate">
                  {term.name}
                </span>
              </div>
              {/* Fake content */}
              <div className="px-1.5 py-1 space-y-0.5">
                {term.lines.map((line, j) => (
                  <div
                    key={j}
                    className="text-[8px] leading-tight truncate"
                    style={{ color: line.color }}
                  >
                    {line.text}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Main component ---
export function WelcomePopup({ onClose }: Props) {
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const backdropRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<TutorialStep>(0);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [switchCount, setSwitchCount] = useState(0);
  const [hasInteractedZoom, setHasInteractedZoom] = useState(false);

  const handleZoomOrPan = useCallback(() => {
    setHasInteractedZoom(true);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape always closes
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      // Step 0: Enter advances to tutorial
      if (step === 0) {
        if (e.key === "Enter") {
          e.preventDefault();
          setStep(1);
        }
        return;
      }

      // During tutorial steps, block all shortcuts from reaching app
      e.preventDefault();
      e.stopPropagation();

      // Step 1: Cmd+E focuses
      if (step === 1 && matchesShortcut(e, shortcuts.clearFocus)) {
        setFocusedIndex(0);
        setStep(2);
        return;
      }

      // Step 2: Cmd+] / Cmd+[ to switch
      if (step === 2) {
        if (matchesShortcut(e, shortcuts.nextTerminal)) {
          setFocusedIndex((i) => (i + 1) % TERMINALS.length);
          setSwitchCount((c) => c + 1);
          return;
        }
        if (matchesShortcut(e, shortcuts.prevTerminal)) {
          setFocusedIndex((i) => (i - 1 + TERMINALS.length) % TERMINALS.length);
          setSwitchCount((c) => c + 1);
          return;
        }
        if (e.key === "Enter" && switchCount >= 2) {
          setStep(3);
          return;
        }
      }

      // Step 3: Enter advances after interaction
      if (step === 3 && e.key === "Enter" && hasInteractedZoom) {
        setStep(4);
        return;
      }

      // Step 4: Enter closes
      if (step === 4 && e.key === "Enter") {
        onClose();
        return;
      }
    };

    window.addEventListener("keydown", handler, true); // capture phase
    return () => window.removeEventListener("keydown", handler, true);
  }, [step, switchCount, hasInteractedZoom, shortcuts, onClose]);

  // --- Step 0: original text page ---
  const shortcutItems = [
    { key: shortcuts.addProject, en: en.shortcut_add_project, zh: zh.shortcut_add_project },
    { key: shortcuts.newTerminal, en: en.shortcut_new_terminal, zh: zh.shortcut_new_terminal },
    { key: shortcuts.toggleSidebar, en: en.shortcut_toggle_sidebar, zh: zh.shortcut_toggle_sidebar },
    { key: shortcuts.clearFocus, en: en.shortcut_clear_focus, zh: zh.shortcut_clear_focus },
  ];

  const textSteps = [
    { en: en.welcome_step_1, zh: zh.welcome_step_1 },
    { en: en.welcome_step_2, zh: zh.welcome_step_2 },
    { en: en.welcome_step_3, zh: zh.welcome_step_3 },
  ];

  // --- Prompt text for tutorial steps ---
  const fmtClearFocus = formatShortcut(shortcuts.clearFocus, isMac);
  const fmtNext = formatShortcut(shortcuts.nextTerminal, isMac);
  const fmtPrev = formatShortcut(shortcuts.prevTerminal, isMac);
  const fmtAddProject = formatShortcut(shortcuts.addProject, isMac);

  function getPrompt(): { en: string; zh: string } | null {
    switch (step) {
      case 1:
        return {
          en: replaceToken(en.onboarding_focus_prompt, "{shortcut}", fmtClearFocus),
          zh: replaceToken(zh.onboarding_focus_prompt, "{shortcut}", fmtClearFocus),
        };
      case 2:
        if (switchCount >= 2) {
          return { en: en.onboarding_switch_continue, zh: zh.onboarding_switch_continue };
        }
        return {
          en: replaceToken(
            replaceToken(en.onboarding_switch_prompt, "{next}", fmtNext),
            "{prev}", fmtPrev,
          ),
          zh: replaceToken(
            replaceToken(zh.onboarding_switch_prompt, "{next}", fmtNext),
            "{prev}", fmtPrev,
          ),
        };
      case 3:
        if (hasInteractedZoom) {
          return { en: en.onboarding_zoom_continue, zh: zh.onboarding_zoom_continue };
        }
        return { en: en.onboarding_zoom_prompt, zh: zh.onboarding_zoom_prompt };
      case 4:
        return {
          en: replaceToken(en.onboarding_complete, "{shortcut}", fmtAddProject),
          zh: replaceToken(zh.onboarding_complete, "{shortcut}", fmtAddProject),
        };
      default:
        return null;
    }
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div
        className="rounded-md bg-[var(--bg)] overflow-hidden flex flex-col border border-[var(--border)] max-w-[560px] w-full mx-4 shadow-2xl max-h-[calc(100dvh-2rem)]"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-2 px-3 py-2 select-none shrink-0">
          <div className="w-[3px] h-3 rounded-full bg-amber-500/60 shrink-0" />
          <span
            className="text-[11px] font-medium"
            style={{ color: "var(--cyan)" }}
          >
            welcome
          </span>
          <span className="text-[11px] text-[var(--text-muted)] truncate flex-1">
            termcanvas
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

        {/* Content */}
        <div className="px-4 pb-5 pt-1 text-[13px] leading-relaxed overflow-y-auto min-h-0">
          {step === 0 ? (
            <>
              <div className="text-[var(--text-muted)] mb-3">
                $ cat welcome.txt
              </div>

              {/* Heading */}
              <div className="mb-4">
                <div className="font-medium text-[14px]">
                  <Bi en={en.welcome_heading} zh={zh.welcome_heading} />
                </div>
                <div className="text-[13px]">
                  <Bi en={en.welcome_desc} zh={zh.welcome_desc} />
                </div>
              </div>

              {/* Quick start */}
              <div className="mb-4">
                <div className="mb-1 font-medium">
                  <Bi en={en.welcome_quick_start} zh={zh.welcome_quick_start} />
                </div>
                <div className="space-y-0.5 pl-2">
                  {textSteps.map((s, i) => (
                    <div key={i}>
                      <span className="text-[var(--text-muted)]">{i + 1}.</span>{" "}
                      <Bi en={s.en} zh={s.zh} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Shortcuts */}
              <div className="mb-4">
                <div className="mb-1 font-medium">
                  <Bi en={en.welcome_shortcuts} zh={zh.welcome_shortcuts} />
                </div>
                <div className="space-y-0.5 pl-2">
                  {shortcutItems.map((item) => (
                    <div key={item.key} className="flex gap-2">
                      <span className="text-[var(--accent)] shrink-0">
                        {formatShortcut(item.key, isMac)}
                      </span>
                      <span>
                        <Bi en={item.en} zh={item.zh} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* GitHub */}
              <div className="mb-4 text-[var(--text-secondary)]">
                GitHub:{" "}
                <a
                  href="https://github.com/blueberrycongee/termcanvas"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent)] hover:underline cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  github.com/blueberrycongee/termcanvas
                </a>
              </div>

              {/* Dismiss */}
              <div className="text-[12px]">
                <Bi en={en.welcome_dismiss} zh={zh.welcome_dismiss} />
              </div>
            </>
          ) : (
            <>
              {/* Mini canvas */}
              <MiniCanvas
                focusedIndex={focusedIndex}
                step={step}
                onZoomOrPan={handleZoomOrPan}
              />

              {/* Prompt area */}
              <div className="mt-3 text-center">
                {(() => {
                  const prompt = getPrompt();
                  if (!prompt) return null;
                  return (
                    <div className="text-[13px]">
                      <Bi en={prompt.en} zh={prompt.zh} />
                    </div>
                  );
                })()}
                {step === 4 && (
                  <div className="text-[11px] mt-1 text-[var(--text-faint)]">
                    <Bi
                      en={en.onboarding_complete_dismiss}
                      zh={zh.onboarding_complete_dismiss}
                    />
                  </div>
                )}
                {step >= 1 && step <= 3 && (
                  <div className="text-[11px] mt-1 text-[var(--text-faint)]">
                    <Bi en={en.onboarding_skip} zh={zh.onboarding_skip} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Verify tests still pass**

Run: `npx tsx --test tests/onboarding-tutorial.test.ts`
Expected: all tests pass

**Step 4: Commit**

```bash
git add src/components/WelcomePopup.tsx
git commit -m "feat(onboarding): rewrite WelcomePopup with interactive mini canvas tutorial"
```

---

### Task 4: Manual smoke test

**Files:** none (manual verification)

**Step 1: Clear localStorage to re-trigger welcome**

Open the app's DevTools console and run:
```js
localStorage.removeItem("termcanvas-welcome-seen")
```
Then reload the app.

**Step 2: Verify step 0 (text page)**

- Existing welcome text is displayed unchanged
- Dismiss text now says "Press Enter to start the interactive tutorial, or Escape to skip"
- Pressing Escape closes the popup

**Step 3: Verify step 1 (focus)**

- Press Enter → mini canvas appears with 4 terminal blocks, none focused
- Press Cmd+E → first terminal gets blue glow border
- Automatically advances to step 2

**Step 4: Verify step 2 (switch)**

- Prompt shows Cmd+] / Cmd+[ instruction
- Pressing Cmd+] moves focus to next terminal
- Pressing Cmd+[ moves focus to previous terminal
- After 2 switches, prompt changes to "Press Enter to continue"
- Press Enter → advances to step 3

**Step 5: Verify step 3 (zoom/pan)**

- Prompt says "Scroll to zoom, drag to pan"
- Scroll wheel zooms the mini canvas
- Click-drag pans the mini canvas
- After any interaction, prompt changes to "Press Enter to continue"
- Press Enter → advances to step 4

**Step 6: Verify step 4 (complete)**

- Shows "Ready! Press Cmd+O to add your first project"
- Press Enter → popup closes
- Reloading the app does NOT show the popup again (localStorage set)

**Step 7: Verify shortcuts don't leak**

- During steps 1-3, pressing Cmd+E / Cmd+] / Cmd+[ does NOT affect the real app behind the popup
- No new terminal is created, no sidebar toggles, etc.
