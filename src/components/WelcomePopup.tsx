import { useEffect, useRef } from "react";
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
      <span className="text-[var(--text-faint)] mx-1">·</span>
      <span style={{ color: "var(--amber)" }}>{zhText}</span>
    </>
  );
}

export function WelcomePopup({ onClose }: Props) {
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const shortcutItems = [
    { key: shortcuts.addProject, en: en.shortcut_add_project, zh: zh.shortcut_add_project },
    { key: shortcuts.newTerminal, en: en.shortcut_new_terminal, zh: zh.shortcut_new_terminal },
    { key: shortcuts.toggleSidebar, en: en.shortcut_toggle_sidebar, zh: zh.shortcut_toggle_sidebar },
    { key: shortcuts.clearFocus, en: en.shortcut_clear_focus, zh: zh.shortcut_clear_focus },
  ];

  const steps = [
    { en: en.welcome_step_1, zh: zh.welcome_step_1 },
    { en: en.welcome_step_2, zh: zh.welcome_step_2 },
    { en: en.welcome_step_3, zh: zh.welcome_step_3 },
  ];

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
            style={{ color: "#50e3c2" }}
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
              {steps.map((step, i) => (
                <div key={i}>
                  <span className="text-[var(--text-muted)]">{i + 1}.</span>{" "}
                  <Bi en={step.en} zh={step.zh} />
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
        </div>
      </div>
    </div>
  );
}
