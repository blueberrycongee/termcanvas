import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
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
] as const;

type TutorialStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Total interactive + info steps (excluding step 0 welcome page)
const TOTAL_STEPS = 7;

// Terminal cell center offsets from grid center.
// Grid: 2 cols × 2 rows, cell 120×80, gap 8px → total 248×168.
const CELL_OFFSETS = [
  { x: -64, y: -44 }, // top-left  (node)
  { x: 64, y: -44 },  // top-right (build)
  { x: -64, y: 44 },  // bottom-left (git)
  { x: 64, y: 44 },   // bottom-right (test)
];
const FOCUS_SCALE = 1.4;

function replaceToken(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5 mt-3">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className="rounded-full transition-all duration-300"
          style={{
            width: i + 1 === current ? 16 : 6,
            height: 6,
            background:
              i + 1 === current
                ? "var(--accent)"
                : i + 1 < current
                  ? "var(--text-muted)"
                  : "var(--border)",
          }}
        />
      ))}
    </div>
  );
}

function MiniCanvas({
  focusedIndex,
  step,
  onZoomOrPan,
  onTerminalDoubleClick,
}: {
  focusedIndex: number;
  step: TutorialStep;
  onZoomOrPan: () => void;
  onTerminalDoubleClick: (index: number) => void;
}) {
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  // Auto-zoom to focused terminal, or fit-all when unfocused
  useEffect(() => {
    if (step >= 1 && step <= 3) {
      if (focusedIndex >= 0) {
        const offset = CELL_OFFSETS[focusedIndex];
        setTransform({ x: -offset.x, y: -offset.y, scale: FOCUS_SCALE });
      } else {
        setTransform({ x: 0, y: 0, scale: 1 });
      }
    }
    if (step === 4) {
      setTransform({ x: 0, y: 0, scale: 1 });
    }
  }, [step, focusedIndex]);

  const handleWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (step !== 4) return;
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setTransform((current) => ({
        ...current,
        scale: Math.max(0.5, Math.min(2, current.scale + delta)),
      }));
      onZoomOrPan();
    },
    [step, onZoomOrPan],
  );

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (step !== 4) return;
      setIsDragging(true);
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
    if (step !== 3) {
      setIsDragging(false);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setTransform((current) => ({
        ...current,
        x: dragStart.current.tx + dx,
        y: dragStart.current.ty + dy,
      }));
      onZoomOrPan();
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [step, isDragging, onZoomOrPan]);

  return (
    <div
      className="relative rounded bg-[var(--bg-secondary)] overflow-hidden select-none"
      style={{
        height: 220,
        cursor: step === 4 ? (isDragging ? "grabbing" : "grab") : "default",
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transition: isDragging ? "none" : "transform 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          {TERMINALS.map((term, index) => (
            <div
              key={term.name}
              className="rounded border transition-all duration-200"
              style={{
                width: 120,
                height: 80,
                borderColor:
                  focusedIndex === index
                    ? "rgba(0,112,243,0.6)"
                    : "var(--border)",
                boxShadow:
                  focusedIndex === index
                    ? "0 0 12px rgba(0,112,243,0.45)"
                    : "none",
                background: "var(--bg)",
              }}
            >
              <div
                className="flex items-center gap-1 px-1.5 py-0.5 border-b border-[var(--border)] cursor-pointer"
                onDoubleClick={() => onTerminalDoubleClick(index)}
              >
                <div
                  className="w-[3px] h-[7px] rounded-full shrink-0"
                  style={{ background: term.color }}
                />
                <span className="text-[9px] text-[var(--text-secondary)] truncate">
                  {term.name}
                </span>
              </div>
              <div className="px-1.5 py-1 space-y-0.5">
                {term.lines.map((line, lineIndex) => (
                  <div
                    key={lineIndex}
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

/** Kbd-style shortcut badge */
function Kbd({ children }: { children: string }) {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        color: "var(--accent)",
      }}
    >
      {children}
    </span>
  );
}

export function WelcomePopup({ onClose }: Props) {
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<TutorialStep>(0);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [hasDoubleClicked, setHasDoubleClicked] = useState(false);
  const [focusToggleCount, setFocusToggleCount] = useState(0);
  const [switchCount, setSwitchCount] = useState(0);
  const [hasInteractedZoom, setHasInteractedZoom] = useState(false);

  const handleZoomOrPan = useCallback(() => {
    setHasInteractedZoom(true);
  }, []);

  const handleTerminalDoubleClick = useCallback(
    (index: number) => {
      // Double-click works in step 1 (dedicated) and later steps
      if (step >= 1) {
        setFocusedIndex(index);
        setHasDoubleClicked(true);
      }
    },
    [step],
  );

  const goBack = useCallback(() => {
    // Only allow going back on non-interactive info steps (5, 6, 7)
    if (step === 5) {
      setStep(4);
    } else if (step === 6) {
      setStep(5);
    } else if (step === 7) {
      setStep(6);
    }
  }, [step]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (step === 0) {
        if (e.key === "Enter") {
          e.preventDefault();
          setStep(1);
        }
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Step 1: double-click (handled via mouse, Enter advances)
      if (step === 1) {
        if (e.key === "Enter" && hasDoubleClicked) {
          setFocusedIndex(-1);
          setStep(2);
        }
        return;
      }

      // Steps 2 & 3 share navigation shortcuts (matching real app)
      if (step === 2 || step === 3) {
        if (matchesShortcut(e, shortcuts.clearFocus)) {
          setFocusedIndex((prev) => {
            if (prev === -1) return 0;
            return -1;
          });
          setFocusToggleCount((c) => c + 1);
          return;
        }

        if (matchesShortcut(e, shortcuts.nextTerminal)) {
          setFocusedIndex((prev) =>
            prev === -1 ? 0 : (prev + 1) % TERMINALS.length,
          );
          if (step === 2) setFocusToggleCount((c) => Math.max(c, 1));
          if (step === 3) setSwitchCount((c) => c + 1);
          return;
        }

        if (matchesShortcut(e, shortcuts.prevTerminal)) {
          setFocusedIndex((prev) =>
            prev === -1 ? TERMINALS.length - 1 : (prev - 1 + TERMINALS.length) % TERMINALS.length,
          );
          if (step === 2) setFocusToggleCount((c) => Math.max(c, 1));
          if (step === 3) setSwitchCount((c) => c + 1);
          return;
        }

        if (e.key === "Enter") {
          if (step === 2 && focusToggleCount >= 2) {
            setFocusedIndex(0);
            setStep(3);
            return;
          }
          if (step === 3 && switchCount >= 2) {
            setStep(4);
            return;
          }
        }
        return;
      }

      if (step === 4 && e.key === "Enter" && hasInteractedZoom) {
        setStep(5);
        return;
      }

      // Info steps: Enter advances, Backspace goes back
      if (step === 5) {
        if (e.key === "Backspace") {
          goBack();
          return;
        }
        if (e.key === "Enter") {
          setStep(6);
          return;
        }
      }

      if (step === 6) {
        if (e.key === "Backspace") {
          goBack();
          return;
        }
        if (e.key === "Enter") {
          setStep(7);
          return;
        }
      }

      if (step === 7) {
        if (e.key === "Backspace") {
          goBack();
          return;
        }
        if (e.key === "Enter") {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [step, hasDoubleClicked, focusToggleCount, switchCount, hasInteractedZoom, shortcuts, onClose, goBack]);

  const shortcutItems = [
    { key: shortcuts.addProject, en: en.shortcut_add_project, zh: zh.shortcut_add_project },
    { key: shortcuts.newTerminal, en: en.shortcut_new_terminal, zh: zh.shortcut_new_terminal },
    { key: shortcuts.toggleSidebar, en: en.shortcut_toggle_sidebar, zh: zh.shortcut_toggle_sidebar },
    { key: shortcuts.toggleRightPanel, en: en.shortcut_toggle_right_panel, zh: zh.shortcut_toggle_right_panel },
    { key: shortcuts.clearFocus, en: en.shortcut_clear_focus, zh: zh.shortcut_clear_focus },
  ];

  const welcomeSteps = [
    { en: en.welcome_step_1, zh: zh.welcome_step_1 },
    { en: en.welcome_step_2, zh: zh.welcome_step_2 },
    { en: en.welcome_step_3, zh: zh.welcome_step_3 },
  ];

  const fmtClearFocus = formatShortcut(shortcuts.clearFocus, isMac);
  const fmtNext = formatShortcut(shortcuts.nextTerminal, isMac);
  const fmtPrev = formatShortcut(shortcuts.prevTerminal, isMac);
  const fmtAddProject = formatShortcut(shortcuts.addProject, isMac);
  const fmtNewTerminal = formatShortcut(shortcuts.newTerminal, isMac);
  const fmtToggleSidebar = formatShortcut(shortcuts.toggleSidebar, isMac);
  const fmtSave = formatShortcut(shortcuts.saveWorkspace, isMac);
  const fmtCloseFocused = formatShortcut(shortcuts.closeFocused, isMac);
  const fmtToggleStar = formatShortcut(shortcuts.toggleStarFocused, isMac);

  function getPrompt(): { en: string; zh: string } | null {
    switch (step) {
      case 1:
        if (hasDoubleClicked) {
          return { en: en.onboarding_switch_continue, zh: zh.onboarding_switch_continue };
        }
        return { en: en.onboarding_dblclick_prompt, zh: zh.onboarding_dblclick_prompt };
      case 2:
        if (focusToggleCount >= 2 && focusedIndex === -1) {
          return { en: en.onboarding_switch_continue, zh: zh.onboarding_switch_continue };
        }
        if (focusedIndex >= 0) {
          return {
            en: replaceToken(en.onboarding_unfocus_prompt, "{shortcut}", fmtClearFocus),
            zh: replaceToken(zh.onboarding_unfocus_prompt, "{shortcut}", fmtClearFocus),
          };
        }
        return {
          en: replaceToken(en.onboarding_focus_prompt, "{shortcut}", fmtClearFocus),
          zh: replaceToken(zh.onboarding_focus_prompt, "{shortcut}", fmtClearFocus),
        };
      case 3:
        if (switchCount >= 2) {
          return { en: en.onboarding_switch_continue, zh: zh.onboarding_switch_continue };
        }
        return {
          en: replaceToken(
            replaceToken(en.onboarding_switch_prompt, "{next}", fmtNext),
            "{prev}",
            fmtPrev,
          ),
          zh: replaceToken(
            replaceToken(zh.onboarding_switch_prompt, "{next}", fmtNext),
            "{prev}",
            fmtPrev,
          ),
        };
      case 4:
        if (hasInteractedZoom) {
          return { en: en.onboarding_zoom_continue, zh: zh.onboarding_zoom_continue };
        }
        return { en: en.onboarding_zoom_prompt, zh: zh.onboarding_zoom_prompt };
      default:
        return null;
    }
  }

  const prompt = getPrompt();

  // Whether the current step shows the mini-canvas (interactive steps 1–4)
  const isInteractiveStep = step >= 1 && step <= 4;
  // Whether the current step is an info page (steps 5–7)
  const isInfoStep = step >= 5 && step <= 7;

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

              <div className="mb-4">
                <div className="font-medium text-[14px]">
                  <Bi en={en.welcome_heading} zh={zh.welcome_heading} />
                </div>
                <div className="text-[13px]">
                  <Bi en={en.welcome_desc} zh={zh.welcome_desc} />
                </div>
              </div>

              <div className="mb-4">
                <div className="mb-1 font-medium">
                  <Bi en={en.welcome_quick_start} zh={zh.welcome_quick_start} />
                </div>
                <div className="space-y-0.5 pl-2">
                  {welcomeSteps.map((stepItem, index) => (
                    <div key={index}>
                      <span className="text-[var(--text-muted)]">{index + 1}.</span>{" "}
                      <Bi en={stepItem.en} zh={stepItem.zh} />
                    </div>
                  ))}
                </div>
              </div>

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

              <div className="text-[12px]">
                <Bi en={en.welcome_dismiss} zh={zh.welcome_dismiss} />
              </div>
            </>
          ) : isInteractiveStep ? (
            <>
              <MiniCanvas
                focusedIndex={focusedIndex}
                step={step}
                onZoomOrPan={handleZoomOrPan}
                onTerminalDoubleClick={handleTerminalDoubleClick}
              />

              <div className="mt-3 text-center">
                {prompt && (
                  <div className="text-[13px]">
                    <Bi en={prompt.en} zh={prompt.zh} />
                  </div>
                )}
                <div className="text-[11px] mt-1 text-[var(--text-faint)]">
                  <Bi en={en.onboarding_skip} zh={zh.onboarding_skip} />
                </div>
              </div>

              <StepDots current={step} total={TOTAL_STEPS} />
            </>
          ) : isInfoStep && step === 5 ? (
            <>
              {/* Step 5: Composer & Tools */}
              <div className="mb-3">
                <div className="font-medium text-[14px] mb-2">
                  <Bi
                    en={en.onboarding_composer_title}
                    zh={zh.onboarding_composer_title}
                  />
                </div>
                <div className="text-[13px] mb-3 text-[var(--text-secondary)]">
                  <Bi
                    en={en.onboarding_composer_desc}
                    zh={zh.onboarding_composer_desc}
                  />
                </div>

                {/* Mini composer illustration */}
                <div
                  className="rounded border border-[var(--border)] overflow-hidden mb-3"
                  style={{ background: "var(--surface)" }}
                >
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: "var(--cyan)" }} />
                      <span className="text-[10px] text-[var(--text-secondary)]">node</span>
                    </div>
                    <div className="flex-1 rounded px-2 py-1 text-[11px] text-[var(--text-muted)]" style={{ background: "var(--bg)" }}>
                      fix the CORS error in server.js
                    </div>
                    <div className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--accent)", color: "white" }}>
                      Send
                    </div>
                  </div>
                  <div className="px-3 py-1.5 text-[10px] text-[var(--text-faint)]">
                    Enter sends · Shift+Enter newline · paste images for agents
                  </div>
                </div>

                <div className="space-y-1 text-[12px]">
                  <div>
                    <Bi
                      en={en.onboarding_composer_tip_1}
                      zh={zh.onboarding_composer_tip_1}
                    />
                  </div>
                  <div>
                    <Bi
                      en={en.onboarding_composer_tip_2}
                      zh={zh.onboarding_composer_tip_2}
                    />
                  </div>
                  <div>
                    <Bi
                      en={en.onboarding_composer_tip_3}
                      zh={zh.onboarding_composer_tip_3}
                    />
                  </div>
                </div>
              </div>

              {/* Navigation buttons */}
              <div className="flex items-center justify-between mt-3">
                <button
                  className="text-[12px] px-2.5 py-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors duration-150"
                  onClick={goBack}
                >
                  <Bi en={en.onboarding_back} zh={zh.onboarding_back} />
                </button>
                <div className="text-[11px] text-[var(--text-faint)]">
                  <Bi en={en.onboarding_skip} zh={zh.onboarding_skip} />
                </div>
                <button
                  className="text-[12px] px-2.5 py-1 rounded text-[var(--accent)] hover:bg-[var(--surface)] transition-colors duration-150"
                  onClick={() => setStep(6)}
                >
                  <Bi en={en.onboarding_next} zh={zh.onboarding_next} />
                </button>
              </div>

              <StepDots current={step} total={TOTAL_STEPS} />
            </>
          ) : isInfoStep && step === 6 ? (
            <>
              {/* Step 6: Keyboard shortcuts reference */}
              <div className="mb-3">
                <div className="font-medium text-[14px] mb-2">
                  <Bi
                    en={en.onboarding_shortcuts_title}
                    zh={zh.onboarding_shortcuts_title}
                  />
                </div>
                <div className="text-[13px] mb-3 text-[var(--text-secondary)]">
                  <Bi
                    en={en.onboarding_shortcuts_desc}
                    zh={zh.onboarding_shortcuts_desc}
                  />
                </div>

                <div className="space-y-1.5 text-[12px]">
                  {[
                    { kbd: fmtAddProject, en: en.shortcut_add_project, zh: zh.shortcut_add_project },
                    { kbd: fmtNewTerminal, en: en.shortcut_new_terminal, zh: zh.shortcut_new_terminal },
                    { kbd: fmtClearFocus, en: en.shortcut_clear_focus, zh: zh.shortcut_clear_focus },
                    { kbd: fmtNext, en: en.shortcut_next_terminal, zh: zh.shortcut_next_terminal },
                    { kbd: fmtPrev, en: en.shortcut_prev_terminal, zh: zh.shortcut_prev_terminal },
                    { kbd: fmtToggleSidebar, en: en.shortcut_toggle_sidebar, zh: zh.shortcut_toggle_sidebar },
                    { kbd: fmtCloseFocused, en: en.shortcut_close_focused, zh: zh.shortcut_close_focused },
                    { kbd: fmtToggleStar, en: en.shortcut_toggle_star_focused, zh: zh.shortcut_toggle_star_focused },
                    { kbd: fmtSave, en: en.shortcut_save_workspace, zh: zh.shortcut_save_workspace },
                  ].map((item) => (
                    <div key={item.kbd} className="flex items-center gap-2">
                      <Kbd>{item.kbd}</Kbd>
                      <span>
                        <Bi en={item.en} zh={item.zh} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Navigation buttons */}
              <div className="flex items-center justify-between mt-3">
                <button
                  className="text-[12px] px-2.5 py-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors duration-150"
                  onClick={goBack}
                >
                  <Bi en={en.onboarding_back} zh={zh.onboarding_back} />
                </button>
                <div className="text-[11px] text-[var(--text-faint)]">
                  <Bi en={en.onboarding_skip} zh={zh.onboarding_skip} />
                </div>
                <button
                  className="text-[12px] px-2.5 py-1 rounded text-[var(--accent)] hover:bg-[var(--surface)] transition-colors duration-150"
                  onClick={() => setStep(7)}
                >
                  <Bi en={en.onboarding_next} zh={zh.onboarding_next} />
                </button>
              </div>

              <StepDots current={step} total={TOTAL_STEPS} />
            </>
          ) : step === 7 ? (
            <>
              {/* Step 7: What makes TermCanvas different + completion */}
              <div className="mb-3">
                <div className="font-medium text-[14px] mb-2">
                  <Bi
                    en={en.onboarding_unique_title}
                    zh={zh.onboarding_unique_title}
                  />
                </div>

                <div className="space-y-2 text-[12px]">
                  <div className="flex gap-2">
                    <span className="text-[var(--cyan)] shrink-0 mt-0.5">&#9656;</span>
                    <span>
                      <Bi
                        en={en.onboarding_unique_1}
                        zh={zh.onboarding_unique_1}
                      />
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[var(--amber)] shrink-0 mt-0.5">&#9656;</span>
                    <span>
                      <Bi
                        en={en.onboarding_unique_2}
                        zh={zh.onboarding_unique_2}
                      />
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[var(--purple)] shrink-0 mt-0.5">&#9656;</span>
                    <span>
                      <Bi
                        en={en.onboarding_unique_3}
                        zh={zh.onboarding_unique_3}
                      />
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[var(--green)] shrink-0 mt-0.5">&#9656;</span>
                    <span>
                      <Bi
                        en={en.onboarding_unique_4}
                        zh={zh.onboarding_unique_4}
                      />
                    </span>
                  </div>
                </div>

                <div
                  className="mt-4 rounded border border-[var(--border)] px-3 py-2.5 text-[13px] text-center"
                  style={{ background: "var(--surface)" }}
                >
                  <Bi
                    en={replaceToken(en.onboarding_complete, "{shortcut}", fmtAddProject)}
                    zh={replaceToken(zh.onboarding_complete, "{shortcut}", fmtAddProject)}
                  />
                </div>
              </div>

              {/* Navigation buttons */}
              <div className="flex items-center justify-between mt-3">
                <button
                  className="text-[12px] px-2.5 py-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors duration-150"
                  onClick={goBack}
                >
                  <Bi en={en.onboarding_back} zh={zh.onboarding_back} />
                </button>
                <div className="text-[11px] text-[var(--text-faint)]">
                  <Bi
                    en={en.onboarding_complete_dismiss}
                    zh={zh.onboarding_complete_dismiss}
                  />
                </div>
                <button
                  className="text-[12px] px-2.5 py-1 rounded text-[var(--accent)] hover:bg-[var(--surface)] transition-colors duration-150"
                  onClick={onClose}
                >
                  <Bi en={en.onboarding_done} zh={zh.onboarding_done} />
                </button>
              </div>

              <StepDots current={step} total={TOTAL_STEPS} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
