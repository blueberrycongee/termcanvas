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

type TutorialStep = 0 | 1 | 2 | 3 | 4 | 5;

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

      if (step === 5 && e.key === "Enter") {
        onClose();
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [step, hasDoubleClicked, focusToggleCount, switchCount, hasInteractedZoom, shortcuts, onClose]);

  const shortcutItems = [
    { key: shortcuts.addProject, en: en.shortcut_add_project, zh: zh.shortcut_add_project },
    { key: shortcuts.newTerminal, en: en.shortcut_new_terminal, zh: zh.shortcut_new_terminal },
    { key: shortcuts.cycleFocusLevel, en: en.shortcut_cycle_focus_level, zh: zh.shortcut_cycle_focus_level },
    { key: shortcuts.toggleRightPanel, en: en.shortcut_toggle_right_panel, zh: zh.shortcut_toggle_right_panel },
    { key: shortcuts.clearFocus, en: en.shortcut_clear_focus, zh: zh.shortcut_clear_focus },
  ];

  const steps = [
    { en: en.welcome_step_1, zh: zh.welcome_step_1 },
    { en: en.welcome_step_2, zh: zh.welcome_step_2 },
    { en: en.welcome_step_3, zh: zh.welcome_step_3 },
  ];

  const fmtClearFocus = formatShortcut(shortcuts.clearFocus, isMac);
  const fmtNext = formatShortcut(shortcuts.nextTerminal, isMac);
  const fmtPrev = formatShortcut(shortcuts.prevTerminal, isMac);
  const fmtAddProject = formatShortcut(shortcuts.addProject, isMac);

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
      case 5:
        return {
          en: replaceToken(en.onboarding_complete, "{shortcut}", fmtAddProject),
          zh: replaceToken(zh.onboarding_complete, "{shortcut}", fmtAddProject),
        };
      default:
        return null;
    }
  }

  const prompt = getPrompt();

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
                  {steps.map((stepItem, index) => (
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
          ) : (
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
                {step === 5 && (
                  <div className="text-[11px] mt-1 text-[var(--text-faint)]">
                    <Bi
                      en={en.onboarding_complete_dismiss}
                      zh={zh.onboarding_complete_dismiss}
                    />
                  </div>
                )}
                {step >= 1 && step <= 4 && (
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
