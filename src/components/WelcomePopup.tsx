import { useState, useEffect, useRef } from "react";
import { en } from "../i18n/en";
import { zh } from "../i18n/zh";
import { useShortcutStore, formatShortcut } from "../stores/shortcutStore";

const isMac = (window.termcanvas?.app.platform ?? "darwin") === "darwin";

interface Props {
  onClose: () => void;
}

function Bi({ en: enText, zh: zhText }: { en: string; zh: string }) {
  return (
    <>
      <span style={{ color: "var(--cyan)" }}>{enText}</span>
      <span className="text-[var(--text-faint)] mx-1">&middot;</span>
      <span style={{ color: "var(--amber)" }}>{zhText}</span>
    </>
  );
}

const TOTAL_STEPS = 4;

const STEP_ICONS = [
  // Canvas: grid with center dot
  <svg
    key="canvas"
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="4" y="4" width="24" height="24" rx="2" />
    <path d="M4 12h24M4 20h24M12 4v24M20 4v24" strokeOpacity="0.3" />
    <circle cx="16" cy="16" r="2" fill="currentColor" stroke="none" />
  </svg>,
  // Terminal window
  <svg
    key="terminal"
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="6" width="26" height="20" rx="2" />
    <path d="M3 10h26" />
    <path d="M10 16l3 3-3 3" />
    <path d="M16 22h6" />
  </svg>,
  // Composer input bar
  <svg
    key="composer"
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="12" width="26" height="8" rx="2" />
    <path d="M7 16h12" />
    <path d="M25 16l-2-2M25 16l-2 2" />
  </svg>,
  // Keyboard
  <svg
    key="keyboard"
    width="32"
    height="32"
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="8" width="26" height="16" rx="2" />
    <rect x="7" y="12" width="4" height="3" rx="0.5" />
    <rect x="14" y="12" width="4" height="3" rx="0.5" />
    <rect x="21" y="12" width="4" height="3" rx="0.5" />
    <rect x="10" y="18" width="12" height="3" rx="0.5" />
  </svg>,
];

export function WelcomePopup({ onClose }: Props) {
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        setStep((s) => {
          if (s < TOTAL_STEPS - 1) return s + 1;
          onClose();
          return s;
        });
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        setStep((s) => Math.max(0, s - 1));
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const shortcutItems = [
    { key: shortcuts.addProject, en: en.shortcut_add_project, zh: zh.shortcut_add_project },
    { key: shortcuts.newTerminal, en: en.shortcut_new_terminal, zh: zh.shortcut_new_terminal },
    { key: shortcuts.clearFocus, en: en.shortcut_clear_focus, zh: zh.shortcut_clear_focus },
    { key: shortcuts.toggleSidebar, en: en.shortcut_toggle_sidebar, zh: zh.shortcut_toggle_sidebar },
  ];

  const stepData = [
    { title: { en: en.onboarding_canvas_title, zh: zh.onboarding_canvas_title }, desc: { en: en.onboarding_canvas_desc, zh: zh.onboarding_canvas_desc } },
    { title: { en: en.onboarding_terminals_title, zh: zh.onboarding_terminals_title }, desc: { en: en.onboarding_terminals_desc, zh: zh.onboarding_terminals_desc } },
    { title: { en: en.onboarding_composer_title, zh: zh.onboarding_composer_title }, desc: { en: en.onboarding_composer_desc, zh: zh.onboarding_composer_desc } },
    { title: { en: en.onboarding_shortcuts_title, zh: zh.onboarding_shortcuts_title }, desc: { en: en.onboarding_shortcuts_desc, zh: zh.onboarding_shortcuts_desc } },
  ];

  const current = stepData[step];

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div
        className="rounded-md bg-[var(--bg)] overflow-hidden flex flex-col border border-[var(--border)] max-w-[480px] w-full mx-4 shadow-2xl"
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

        {/* Step content */}
        <div className="px-5 pt-4 pb-3 text-center">
          <div className="flex justify-center mb-3 text-[var(--text-secondary)]">
            {STEP_ICONS[step]}
          </div>
          <div className="font-medium text-[14px] mb-2">
            <Bi en={current.title.en} zh={current.title.zh} />
          </div>
          <div className="text-[13px] leading-relaxed">
            <Bi en={current.desc.en} zh={current.desc.zh} />
          </div>

          {/* Shortcut list on the last step */}
          {step === TOTAL_STEPS - 1 && (
            <div className="mt-3 space-y-1 inline-block text-left">
              {shortcutItems.map((item) => (
                <div key={item.key} className="flex gap-2 text-[12px]">
                  <span className="text-[var(--accent)] shrink-0">
                    {formatShortcut(item.key, isMac)}
                  </span>
                  <Bi en={item.en} zh={item.zh} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer: progress dots + navigation */}
        <div className="px-5 pb-4 pt-1 flex items-center justify-between">
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: i === step ? "var(--accent)" : "var(--border)",
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="text-[12px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors px-2 py-1"
              onClick={onClose}
            >
              {en.onboarding_btn_skip}
            </button>
            {step > 0 && (
              <button
                className="text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-2 py-1 rounded border border-[var(--border)]"
                onClick={() => setStep(step - 1)}
              >
                {en.onboarding_btn_back}
              </button>
            )}
            <button
              className="text-[12px] bg-[var(--accent)] text-[var(--bg)] hover:opacity-90 transition-opacity px-3 py-1 rounded"
              onClick={() => {
                if (step < TOTAL_STEPS - 1) setStep(step + 1);
                else onClose();
              }}
            >
              {step < TOTAL_STEPS - 1 ? en.onboarding_btn_next : en.onboarding_btn_done}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
