import { useState, useEffect, useRef } from "react";

export interface DemoAnimationProps {
  autoplay?: boolean;
  /**
   * Per-field shortcut overrides. Missing fields fall back to the
   * `DEFAULT_SHORTCUTS` constant, so callers only need to pass the
   * shortcuts they actually care about binding to user prefs.
   */
  shortcuts?: Partial<{
    clearFocus: string;
    nextTerminal: string;
    prevTerminal: string;
    addProject: string;
    openUsage: string;
  }>;
}

const DEFAULT_SHORTCUTS = {
  clearFocus: "⌘ E",
  nextTerminal: "⌘ ]",
  prevTerminal: "⌘ [",
  addProject: "⌘ O",
  openUsage: "⌘⇧ U",
};

function Bi({ en: e, zh: z }: { en: string; zh: string }) {
  return (
    <>
      <span style={{ color: "var(--cyan)" }}>{e}</span>
      <span className="text-[var(--text-faint)] mx-1">·</span>
      <span style={{ color: "var(--amber)" }}>{z}</span>
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
      { text: "$ pnpm build", color: "var(--text-muted)" },
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
      { text: "$ pnpm test", color: "var(--text-muted)" },
      { text: "4 passing (12ms)", color: "var(--green)" },
    ],
  },
] as const;

const TILE_OFFSETS = [
  { x: -64, y: -44 },
  { x: 64, y: -44 },
  { x: -64, y: 44 },
  { x: 64, y: 44 },
];

const PHASES = [
  { en: "Intro", zh: "开始" },
  { en: "Focus", zh: "聚焦" },
  { en: "Switch", zh: "切换" },
  { en: "Unfocus", zh: "取消" },
  { en: "Zoom", zh: "缩放" },
  { en: "Project", zh: "项目" },
  { en: "Code", zh: "代码" },
  { en: "Replay", zh: "回放" },
  { en: "Done", zh: "完成" },
] as const;

function DemoCursor({
  pos,
  dragging,
  visible,
}: {
  pos: { x: number; y: number };
  dragging: boolean;
  visible: boolean;
}) {
  return (
    <svg
      width="16"
      height="20"
      viewBox="0 0 16 20"
      fill="none"
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        opacity: visible ? 1 : 0,
        transition: dragging
          ? "opacity 200ms"
          : "left 600ms cubic-bezier(0.4, 0, 0.2, 1), top 600ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms",
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
        pointerEvents: "none",
        zIndex: 50,
      }}
    >
      <path
        d="M1 1L1 14L4.5 10.5L8 18L10.5 17L7 9.5L12 9.5L1 1Z"
        fill="white"
        stroke="#1a1a1a"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DemoTile({
  name,
  color,
  lines,
  focused,
  visible,
}: {
  name: string;
  color: string;
  lines: { text: string; color: string }[];
  focused: boolean;
  visible: boolean;
}) {
  return (
    <div
      className="rounded border"
      style={{
        width: 120,
        height: 80,
        background: "var(--bg)",
        borderColor: focused ? "rgba(91,158,245,0.9)" : "var(--border)",
        boxShadow: focused
          ? "0 0 16px rgba(91,158,245,0.6), 0 0 32px rgba(91,158,245,0.25), inset 0 0 8px rgba(91,158,245,0.1)"
          : "none",
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.95)",
        transition: "all 200ms ease-out",
      }}
    >
      <div className="flex items-center gap-1 px-1.5 py-0.5 border-b border-[var(--border)]">
        <div
          className="w-[3px] h-[7px] rounded-full shrink-0"
          style={{ background: color }}
        />
        <span className="text-[9px] text-[var(--text-secondary)] truncate">
          {name}
        </span>
      </div>
      <div className="px-1.5 py-1 space-y-0.5">
        {lines.map((line, i) => (
          <div
            key={i}
            className="text-[8px] leading-tight truncate"
            style={{ color: line.color }}
          >
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}

const HISTORY_ENTRIES = [
  { provider: "claude", title: "Add session history to sidebar", age: "2m" },
  { provider: "codex", title: "Fix Codex resume id", age: "18m" },
  { provider: "claude", title: "Monaco drawer theme tint", age: "1h" },
  { provider: "codex", title: "Swap panels: files to right", age: "3h" },
] as const;

/*
 * Left panel — v0.30 project management + history.
 *
 * Always visible; collapsing it isn't part of the demo story.
 * Mirrors the real LeftPanel layout: header with "+" button,
 * ProjectTree expanded, HistorySection below. Phase 5 highlights
 * the "+" button; Phase 7 highlights a history row.
 */
function DemoLeftPanel({
  expanded,
  addProjectHot,
  historyHot,
  showSecondProject,
  historyExpanded,
  addButtonRef,
  historyHeaderRef,
  firstHistoryRowRef,
}: {
  /**
   * When false, shows a 32-px collapsed strip with just a "+" icon
   * and an expand chevron — matches the real LeftPanel's collapsed
   * state. When true, shows the full project tree + history.
   */
  expanded: boolean;
  addProjectHot: boolean;
  historyHot: number; // -1 = none, else index
  showSecondProject: boolean;
  historyExpanded: boolean;
  addButtonRef?: React.RefObject<HTMLDivElement | null>;
  historyHeaderRef?: React.RefObject<HTMLDivElement | null>;
  firstHistoryRowRef?: React.RefObject<HTMLDivElement | null>;
}) {
  if (!expanded) {
    return (
      <div
        className="shrink-0 flex flex-col items-center pt-2 gap-1.5 border-r border-[var(--border)] overflow-hidden"
        style={{
          width: 32,
          background: "var(--sidebar)",
          transition: "width 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
      >
        {/* "+" button — primary action even when collapsed. */}
        <div
          ref={addButtonRef}
          className="w-3.5 h-3.5 rounded flex items-center justify-center transition-all duration-200"
          style={{
            background: addProjectHot ? "var(--accent)" : "transparent",
            border: `1px solid ${addProjectHot ? "var(--accent)" : "var(--border)"}`,
            color: addProjectHot ? "var(--bg)" : "var(--text-muted)",
            boxShadow: addProjectHot ? "0 0 8px rgba(91,158,245,0.6)" : "none",
          }}
        >
          <svg width="7" height="7" viewBox="0 0 12 12" fill="none">
            <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div className="mt-auto mb-2">
          {/* Expand chevron, pointing right. */}
          <svg width="7" height="7" viewBox="0 0 10 10" fill="none">
            <path
              d="M3 2L7 5L3 8"
              stroke="var(--text-muted)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 flex flex-col border-r border-[var(--border)] overflow-hidden"
      style={{
        width: 140,
        background: "var(--sidebar)",
        transition: "width 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      }}
    >
      {/* Header */}
      <div
        className="shrink-0 flex items-center justify-between px-2 py-1.5 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="text-[7px] uppercase tracking-widest font-medium"
          style={{ color: "var(--text-muted)", fontFamily: '"Geist Mono", monospace' }}
        >
          Sessions
        </span>
        <div
          ref={addButtonRef}
          className="w-3.5 h-3.5 rounded flex items-center justify-center transition-all duration-200"
          style={{
            background: addProjectHot ? "var(--accent)" : "transparent",
            border: `1px solid ${addProjectHot ? "var(--accent)" : "var(--border)"}`,
            color: addProjectHot ? "var(--bg)" : "var(--text-muted)",
            boxShadow: addProjectHot ? "0 0 8px rgba(91,158,245,0.6)" : "none",
          }}
        >
          <svg width="7" height="7" viewBox="0 0 12 12" fill="none">
            <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* Projects */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="px-1.5 pt-1.5 flex flex-col gap-0.5">
          {/* First project */}
          <div className="flex items-center gap-1">
            <span className="text-[7px]" style={{ color: "var(--accent)" }}>▼</span>
            <span className="text-[8px] font-medium" style={{ color: "var(--text-primary)" }}>
              termcanvas
            </span>
          </div>
          <div className="flex items-center gap-1 pl-2">
            <span className="text-[7px]" style={{ color: "var(--accent)" }}>▼</span>
            <div className="w-[3px] h-[5px] rounded-full" style={{ background: "var(--green)" }} />
            <span className="text-[7px]" style={{ color: "var(--text-muted)" }}>main</span>
          </div>
          {TERMINALS.map((t) => (
            <div key={t.name} className="flex items-center gap-1 pl-5">
              <div className="w-1 h-1 rounded-full" style={{ background: t.color }} />
              <span className="text-[7px] text-[var(--text-muted)]">{t.name}</span>
            </div>
          ))}

          {/* Second project (added in Phase 5) */}
          <div
            style={{
              opacity: showSecondProject ? 1 : 0,
              transform: showSecondProject ? "translateY(0)" : "translateY(-4px)",
              transition: "opacity 300ms ease-out, transform 300ms ease-out",
              overflow: "hidden",
              maxHeight: showSecondProject ? 32 : 0,
            }}
          >
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[7px]" style={{ color: "var(--accent)" }}>▼</span>
              <span className="text-[8px] font-medium" style={{ color: "var(--text-primary)" }}>
                my-app
              </span>
            </div>
            <div className="flex items-center gap-1 pl-2">
              <div className="w-[3px] h-[5px] rounded-full" style={{ background: "var(--cyan)" }} />
              <span className="text-[7px]" style={{ color: "var(--text-muted)" }}>main</span>
            </div>
          </div>
        </div>

        {/* History section (bottom) */}
        <div
          className="mt-auto border-t border-[var(--border)]"
          style={{ background: "var(--sidebar)" }}
        >
          <div
            ref={historyHeaderRef}
            className="flex items-center gap-1 px-2 py-1"
            style={{ background: historyExpanded ? "var(--surface)" : "transparent" }}
          >
            <span
              className="text-[7px]"
              style={{
                color: "var(--text-muted)",
                transform: historyExpanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 200ms",
              }}
            >
              ▶
            </span>
            <span
              className="text-[7px] uppercase tracking-widest"
              style={{ color: "var(--text-muted)", fontFamily: '"Geist Mono", monospace' }}
            >
              History
            </span>
          </div>
          {historyExpanded && (
            <div className="px-1.5 pb-1.5 flex flex-col">
              {HISTORY_ENTRIES.map((h, i) => (
                <div
                  key={i}
                  ref={i === 0 ? firstHistoryRowRef : undefined}
                  className="flex items-start gap-1 px-1 py-0.5 rounded transition-colors duration-150"
                  style={{
                    background:
                      historyHot === i ? "rgba(91,158,245,0.18)" : "transparent",
                  }}
                >
                  <span
                    className="mt-[3px] w-1 h-1 rounded-full shrink-0"
                    style={{
                      background: h.provider === "claude" ? "var(--amber)" : "var(--green)",
                    }}
                  />
                  <div className="min-w-0 flex-1 flex flex-col">
                    <span
                      className="text-[7px] truncate"
                      style={{
                        color:
                          historyHot === i
                            ? "var(--text-primary)"
                            : "var(--text-secondary)",
                      }}
                    >
                      {h.title}
                    </span>
                    <span className="text-[6px] text-[var(--text-faint)]">
                      {h.provider} · {h.age}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/*
 * Right panel — v0.30 code-nav tabs (Files / Diff / Git / Memory).
 * Starts collapsed (thin strip of icons); Phase 6 expands it to
 * show the Files tab with a file list, then Phase 6 again hovers a
 * file which triggers the Monaco drawer overlay.
 */
function DemoRightPanel({
  expanded,
  activeTab,
  hotFile,
  hotFileRef,
  stripRef,
}: {
  /**
   * Always rendered — mirrors the real app where the code-nav
   * panel is visible as a 26-px strip even when collapsed. Phase 6
   * flips this to true on click, expanding to show the Files tree.
   */
  expanded: boolean;
  activeTab: "files" | "diff" | "git";
  hotFile: string | null;
  hotFileRef?: React.RefObject<HTMLDivElement | null>;
  stripRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const tabIcons = [
    { key: "files", label: "Files" },
    { key: "diff", label: "Diff" },
    { key: "git", label: "Git" },
    { key: "memory", label: "Mem" },
  ] as const;

  return (
    <div
      ref={stripRef}
      className="shrink-0 flex flex-col border-l border-[var(--border)] overflow-hidden"
      style={{
        width: expanded ? 140 : 26,
        background: expanded ? "var(--surface)" : "var(--sidebar)",
        transition: "width 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94), background 200ms",
      }}
    >
      {expanded ? (
        <>
          <div className="shrink-0 flex gap-0.5 p-1 mx-1 mt-1.5 rounded-md" style={{ background: "var(--bg)" }}>
            {tabIcons.map((tab) => (
              <div
                key={tab.key}
                className="flex-1 text-center py-0.5 rounded text-[7px]"
                style={{
                  background: activeTab === tab.key ? "var(--surface-hover)" : "transparent",
                  color: activeTab === tab.key ? "var(--text-primary)" : "var(--text-muted)",
                  transition: "background 150ms, color 150ms",
                }}
              >
                {tab.label}
              </div>
            ))}
          </div>
          <div className="flex-1 min-h-0 px-1.5 pt-2 flex flex-col gap-0.5 overflow-hidden">
            <div className="flex items-center gap-1">
              <span className="text-[7px]" style={{ color: "var(--accent)" }}>▼</span>
              <span className="text-[7px] font-medium" style={{ color: "var(--text-secondary)" }}>src</span>
            </div>
            {["App.tsx", "LeftPanel.tsx", "RightPanel.tsx", "FileEditorDrawer.tsx", "UsageOverlay.tsx"].map((f) => (
              <div
                key={f}
                ref={f === "FileEditorDrawer.tsx" ? hotFileRef : undefined}
                className="pl-3 flex items-center gap-1 rounded transition-colors duration-150"
                style={{
                  background: hotFile === f ? "rgba(91,158,245,0.18)" : "transparent",
                }}
              >
                <div className="w-1 h-1 rounded-full" style={{ background: "var(--text-faint)" }} />
                <span
                  className="text-[7px]"
                  style={{
                    color: hotFile === f ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {f}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center pt-2 gap-2">
          {tabIcons.map((tab, i) => (
            <div
              key={tab.key}
              className="w-3.5 h-3.5 rounded"
              style={{
                background: i === 0 ? "var(--surface-hover)" : "transparent",
                border: `1px solid ${i === 0 ? "var(--border)" : "transparent"}`,
                opacity: i === 0 ? 1 : 0.45,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div className="w-[7px] h-[7px] rounded-sm" style={{ background: "var(--text-muted)" }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/*
 * Monaco editor drawer — right-anchored overlay. Slides in from the
 * LEFT edge of the right panel, covers ~60% of the canvas area. In
 * the demo we fake the editor surface with colour-tinted line mocks
 * matching our app-tinted Monaco themes.
 */
function DemoMonacoDrawer({ open }: { open: boolean }) {
  // Borders only when open — otherwise the drawer's `border-l` +
  // `border-r` stack on top of each other at width=0 and render as
  // a 2-px grey vertical line floating in the canvas, which reads
  // as unexplained chrome to a first-time viewer.
  const borderClasses = open ? "border-l border-r border-[var(--border)]" : "";
  const lines = [
    { tokens: [["keyword", "import"], ["txt", " { useCanvasStore } "], ["keyword", "from"], ["str", " \"./stores\""], ["txt", ";"]] },
    { tokens: [["keyword", "export"], ["keyword", " function"], ["fn", " FileEditorDrawer"], ["txt", "() {"]] },
    { tokens: [["txt", "  "], ["keyword", "const"], ["txt", " path = useCanvasStore(s => s."], ["fn", "fileEditorPath"], ["txt", ");"]] },
    { tokens: [["txt", "  "], ["keyword", "const"], ["txt", " expanded = useCanvasStore(s => s."], ["fn", "fileEditorExpanded"], ["txt", ");"]] },
    { tokens: [] },
    { tokens: [["txt", "  "], ["keyword", "if"], ["txt", " (!path) "], ["keyword", "return null"], ["txt", ";"]] },
    { tokens: [] },
    { tokens: [["txt", "  "], ["keyword", "return"], ["txt", " ("]] },
    { tokens: [["txt", "    <Drawer anchor="], ["str", "\"right\""], ["txt", " width={expanded ? "], ["num", "\"100%\""], ["txt", " : "], ["num", "\"60vw\""], ["txt", "}>"]] },
    { tokens: [["txt", "      <MonacoEditor path={path} "], ["attr", "theme"], ["txt", "={"], ["str", "\"termcanvas-dark\""], ["txt", "} />"]] },
    { tokens: [["txt", "    </Drawer>"]] },
    { tokens: [["txt", "  );"]] },
    { tokens: [["txt", "}"]] },
  ];
  const colorFor = (tok: string) => {
    switch (tok) {
      case "keyword": return "var(--purple)";
      case "fn": return "var(--accent)";
      case "str": return "var(--green)";
      case "num": return "var(--amber)";
      case "attr": return "var(--cyan)";
      default: return "var(--text-secondary)";
    }
  };
  return (
    <div
      className={`absolute top-0 bottom-0 flex flex-col overflow-hidden ${borderClasses}`}
      style={{
        // Anchored to the canvas's right edge — which is already the
        // right panel's left edge because the canvas is sandwiched
        // between the two panels via flex layout. No extra offset.
        right: 0,
        width: open ? "62%" : 0,
        background: "var(--bg)",
        boxShadow: open ? "-4px 0 16px rgba(0,0,0,0.25)" : "none",
        transition: "width 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        zIndex: 40,
      }}
    >
      {open && (
        <>
          {/* Header */}
          <div
            className="shrink-0 flex items-center gap-1.5 px-2 py-1 border-b"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <span
              className="text-[8px] font-medium"
              style={{ color: "var(--text-primary)", fontFamily: '"Geist Mono", monospace' }}
            >
              FileEditorDrawer.tsx
            </span>
            <span className="w-1 h-1 rounded-full shrink-0" style={{ background: "var(--accent)" }} />
            <span className="ml-auto text-[7px]" style={{ color: "var(--text-muted)" }}>⌘S</span>
          </div>
          {/* Editor body */}
          <div className="flex-1 min-h-0 px-2 py-1.5 overflow-hidden">
            {lines.map((line, i) => (
              <div key={i} className="flex items-center gap-2 leading-tight" style={{ height: 11 }}>
                <span
                  className="text-[6px] text-right shrink-0"
                  style={{ color: "var(--text-faint)", width: 10, fontFamily: '"Geist Mono", monospace' }}
                >
                  {i + 1}
                </span>
                <span
                  className="text-[7px] whitespace-pre"
                  style={{ fontFamily: '"Geist Mono", monospace' }}
                >
                  {line.tokens.length === 0 ? (
                    "\u00a0"
                  ) : (
                    line.tokens.map(([tok, txt], j) => (
                      <span key={j} style={{ color: colorFor(tok) }}>{txt}</span>
                    ))
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/*
 * Session replay drawer — left-anchored overlay. Slides in from the
 * RIGHT edge of the left panel. Mocks the replay view with two
 * chat bubbles + a resume button.
 */
function DemoReplayDrawer({ open }: { open: boolean }) {
  // See DemoMonacoDrawer — borders only when open, otherwise the
  // collapsed 0-px drawer renders as a 2-px grey line glued to the
  // left panel's right edge.
  const borderClasses = open ? "border-l border-r border-[var(--border)]" : "";
  return (
    <div
      className={`absolute top-0 bottom-0 flex flex-col overflow-hidden ${borderClasses}`}
      style={{
        // Anchored to the canvas's left edge — canvas sits right
        // after the left panel, so left: 0 lines up flush with the
        // left panel's right edge. No extra offset.
        left: 0,
        width: open ? "62%" : 0,
        background: "var(--bg)",
        boxShadow: open ? "4px 0 16px rgba(0,0,0,0.25)" : "none",
        transition: "width 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        zIndex: 40,
      }}
    >
      {open && (
        <>
          <div
            className="shrink-0 flex items-center gap-1.5 px-2 py-1 border-b"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <span
              className="text-[7px] uppercase tracking-widest"
              style={{ color: "var(--text-primary)", fontFamily: '"Geist Mono", monospace' }}
            >
              Replay
            </span>
            <span className="ml-auto text-[7px]" style={{ color: "var(--text-muted)" }}>Esc</span>
          </div>
          <div className="flex-1 min-h-0 px-2 py-2 flex flex-col gap-1.5 overflow-hidden">
            <div
              className="self-end rounded-md px-1.5 py-1"
              style={{ background: "var(--surface)", maxWidth: "80%" }}
            >
              <span className="text-[7px]" style={{ color: "var(--text-primary)" }}>
                Add session history to sidebar
              </span>
            </div>
            <div
              className="self-start rounded-md px-1.5 py-1"
              style={{ background: "var(--surface)", maxWidth: "85%" }}
            >
              <span className="text-[7px]" style={{ color: "var(--text-secondary)", lineHeight: 1.45 }}>
                I'll extract HistorySection from SessionsPanel and mount it below ProjectTree in the left panel…
              </span>
            </div>
            <div
              className="self-start rounded-md px-1.5 py-1 flex items-center gap-1"
              style={{ background: "rgba(91,158,245,0.12)", border: "1px solid rgba(91,158,245,0.4)" }}
            >
              <svg width="6" height="6" viewBox="0 0 10 10" fill="none">
                <path d="M2 1l6 4-6 4V1z" fill="var(--accent)" />
              </svg>
              <span className="text-[7px]" style={{ color: "var(--accent)" }}>
                Continue in new terminal
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/*
 * Usage dashboard panel — canvas-gap tenant, occupies the space
 * between the left and right panels. Single level, no expand.
 * Shown in the "Done" phase as a quick teaser of the dashboard.
 */
/*
 * Usage dashboard — mirrors the real UsageOverlay at demo scale.
 * Stat strip → two charts → 3-column bar lists → quota → heatmap.
 * Everything is static mock data, but the section structure +
 * proportions match so the viewer recognises it as the same
 * dashboard they'd see in-app (just shrunk).
 */
function DemoUsagePanel({ open }: { open: boolean }) {
  // 24 hourly buckets for the sparkline. Curve simulates a real
  // workday: quiet morning, ramp into mid-afternoon peak, taper.
  const hourly = [
    2, 1, 1, 0, 0, 2, 6, 12, 18, 24, 20, 28,
    34, 30, 42, 38, 46, 44, 32, 28, 18, 10, 6, 3,
  ];
  const hourlyMax = Math.max(...hourly);
  // 30 daily buckets for the trend chart.
  const trend = [
    4, 7, 5, 9, 6, 12, 8, 14, 10, 16, 11, 18, 13, 20, 14,
    22, 17, 26, 20, 28, 22, 30, 24, 34, 27, 38, 30, 40, 32, 44,
  ];
  const trendMax = Math.max(...trend);
  const cacheRows = [
    { label: "Overall", pct: 82, color: "#eab308" },
    { label: "Claude", pct: 88, color: "#eab308" },
    { label: "Codex", pct: 74, color: "#eab308" },
  ];
  const projectRows = [
    { label: "termcanvas", pct: 68, color: "var(--accent)" },
    { label: "hydra", pct: 42, color: "var(--accent)" },
    { label: "browse", pct: 20, color: "var(--accent)" },
  ];
  const modelRows = [
    { label: "opus-4", pct: 72, color: "#f97316" },
    { label: "sonnet-4", pct: 48, color: "#a855f7" },
    { label: "haiku-4", pct: 24, color: "#06b6d4" },
    { label: "codex", pct: 36, color: "#8b5cf6" },
  ];
  // 14×7 heatmap grid (14 weeks back).
  const heatmapCells: number[] = [];
  for (let i = 0; i < 14 * 7; i += 1) {
    // Bias toward low values with occasional high days, to look
    // like a real activity history.
    const r = Math.sin(i * 1.31) * 0.5 + 0.5;
    heatmapCells.push(r < 0.35 ? 0 : r < 0.55 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : 4);
  }

  return (
    <div
      className="absolute top-0 bottom-0 flex flex-col overflow-hidden"
      style={{
        left: 0,
        right: 0,
        background: "var(--bg)",
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
        transition: "opacity 220ms ease-out",
        zIndex: 38,
      }}
    >
      {open && (
        <div className="h-full flex flex-col px-3 py-2 gap-1.5 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between shrink-0">
            <span
              className="text-[10px] font-semibold"
              style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
            >
              Usage
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[7px]" style={{ color: "var(--text-muted)" }}>
                Apr 18
              </span>
              <span className="text-[7px]" style={{ color: "var(--text-faint)" }}>Esc</span>
            </div>
          </div>

          {/* Row 1: stat strip */}
          <div className="grid grid-cols-4 gap-1 shrink-0">
            {[
              { label: "Today", value: "$4.82", sub: "12 sessions" },
              { label: "MTD", value: "$62.1", sub: "18 active days" },
              { label: "Daily avg", value: "$3.45", sub: "per active day" },
              { label: "Projected", value: "$96.3", sub: "+$34.2 to go", accent: true },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded border px-1.5 py-1"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <div
                  className="text-[6px] uppercase tracking-widest"
                  style={{ color: "var(--text-muted)", fontFamily: '"Geist Mono", monospace' }}
                >
                  {s.label}
                </div>
                <div
                  className="text-[10px] font-semibold leading-none mt-0.5"
                  style={{
                    color: "var(--text-primary)",
                    fontFamily: '"Geist Mono", monospace',
                    letterSpacing: "-0.02em",
                  }}
                >
                  {s.value}
                </div>
                <div
                  className="text-[6px] mt-0.5"
                  style={{
                    color: s.accent ? "var(--accent)" : "var(--text-faint)",
                    fontFamily: '"Geist Mono", monospace',
                  }}
                >
                  {s.sub}
                </div>
              </div>
            ))}
          </div>

          {/* Row 2: two charts side by side (hourly + 30-day trend) */}
          <div className="grid grid-cols-2 gap-1 shrink-0">
            {[
              { title: "Timeline (today)", data: hourly, max: hourlyMax, labels: ["00", "06", "12", "18", "24"] },
              { title: "Last 30 days", data: trend, max: trendMax, labels: ["Mar 20", "Mar 27", "Apr 3", "Apr 10", "Apr 18"] },
            ].map((chart) => (
              <div
                key={chart.title}
                className="rounded border"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <div
                  className="px-1.5 py-1 border-b text-[6px] uppercase tracking-widest"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text-muted)",
                    fontFamily: '"Geist Mono", monospace',
                  }}
                >
                  {chart.title}
                </div>
                <div className="px-1.5 py-1">
                  <div className="flex items-end gap-[1px]" style={{ height: 28 }}>
                    {chart.data.map((v, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-sm"
                        style={{
                          height: `${(v / chart.max) * 100}%`,
                          background: "var(--accent)",
                          opacity: 0.4 + (v / chart.max) * 0.55,
                          minHeight: 2,
                        }}
                      />
                    ))}
                  </div>
                  <div
                    className="flex justify-between mt-0.5 text-[6px]"
                    style={{ color: "var(--text-faint)", fontFamily: '"Geist Mono", monospace' }}
                  >
                    {chart.labels.map((l) => (
                      <span key={l}>{l}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Row 3: three-column bar lists — cache rate, projects, models */}
          <div className="grid grid-cols-3 gap-1 shrink-0">
            {[
              { title: "Cache rate", rows: cacheRows, right: "%" as const },
              { title: "Projects", rows: projectRows, right: "%" as const },
              { title: "Models", rows: modelRows, right: "%" as const },
            ].map((col) => (
              <div
                key={col.title}
                className="rounded border"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <div
                  className="px-1.5 py-1 border-b text-[6px] uppercase tracking-widest"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text-muted)",
                    fontFamily: '"Geist Mono", monospace',
                  }}
                >
                  {col.title}
                </div>
                <div className="px-1.5 py-1 flex flex-col gap-[3px]">
                  {col.rows.map((r) => (
                    <div key={r.label} className="flex items-center gap-1">
                      <span
                        className="text-[6px] shrink-0 truncate"
                        style={{ color: "var(--text-muted)", width: 26, fontFamily: '"Geist Mono", monospace' }}
                      >
                        {r.label}
                      </span>
                      <div
                        className="flex-1 rounded-full overflow-hidden"
                        style={{ height: 3, background: "var(--border)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${r.pct}%`, background: r.color, opacity: 0.8 }}
                        />
                      </div>
                      <span
                        className="text-[6px] shrink-0 tabular-nums"
                        style={{ color: "var(--text-muted)", width: 10, textAlign: "right", fontFamily: '"Geist Mono", monospace' }}
                      >
                        {r.pct}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Row 4: quota meters */}
          <div
            className="rounded border px-1.5 py-1 shrink-0"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <div
              className="text-[6px] uppercase tracking-widest"
              style={{ color: "var(--text-muted)", fontFamily: '"Geist Mono", monospace' }}
            >
              Quotas
            </div>
            <div className="mt-1 flex flex-col gap-1">
              {[
                { label: "Claude 5h", pct: 48, color: "#22c55e", reset: "3:12" },
                { label: "Claude 7d", pct: 72, color: "#eab308", reset: "2d 14h" },
                { label: "Codex 5h", pct: 22, color: "#22c55e", reset: "4:41" },
              ].map((q) => (
                <div key={q.label} className="flex items-center gap-1">
                  <span
                    className="text-[6px] shrink-0"
                    style={{ color: "var(--text-muted)", width: 46, fontFamily: '"Geist Mono", monospace' }}
                  >
                    {q.label}
                  </span>
                  <div
                    className="flex-1 rounded-full overflow-hidden"
                    style={{ height: 3, background: "var(--border)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${q.pct}%`, background: q.color, opacity: 0.85 }}
                    />
                  </div>
                  <span
                    className="text-[6px] shrink-0 tabular-nums"
                    style={{ color: "var(--text-muted)", width: 20, textAlign: "right", fontFamily: '"Geist Mono", monospace' }}
                  >
                    {q.pct}%
                  </span>
                  <span
                    className="text-[6px] shrink-0 tabular-nums"
                    style={{ color: "var(--text-faint)", width: 24, textAlign: "right", fontFamily: '"Geist Mono", monospace' }}
                  >
                    {q.reset}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Row 5: heatmap calendar ribbon */}
          <div
            className="rounded border px-1.5 py-1 flex-1 min-h-0"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <div className="flex items-center justify-between">
              <span
                className="text-[6px] uppercase tracking-widest"
                style={{ color: "var(--text-muted)", fontFamily: '"Geist Mono", monospace' }}
              >
                Heatmap
              </span>
              <div className="flex items-center gap-[2px]">
                <span
                  className="text-[6px]"
                  style={{ color: "var(--text-faint)", fontFamily: '"Geist Mono", monospace' }}
                >
                  less
                </span>
                {[0, 1, 2, 3, 4].map((lvl) => (
                  <div
                    key={lvl}
                    className="rounded-[1px]"
                    style={{
                      width: 5,
                      height: 5,
                      background:
                        lvl === 0
                          ? "var(--border)"
                          : `color-mix(in srgb, var(--accent) ${20 + lvl * 20}%, transparent)`,
                    }}
                  />
                ))}
                <span
                  className="text-[6px]"
                  style={{ color: "var(--text-faint)", fontFamily: '"Geist Mono", monospace' }}
                >
                  more
                </span>
              </div>
            </div>
            <div className="mt-1 flex items-center justify-center">
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "repeat(14, 5px)",
                  gridTemplateRows: "repeat(7, 5px)",
                  gap: 2,
                  gridAutoFlow: "column",
                }}
              >
                {heatmapCells.map((level, i) => (
                  <div
                    key={i}
                    className="rounded-[1px]"
                    style={{
                      background:
                        level === 0
                          ? "var(--border)"
                          : `color-mix(in srgb, var(--accent) ${20 + level * 20}%, transparent)`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function KeystrokePopup({
  keys,
  visibleCount,
  label,
}: {
  keys: [string, string];
  visibleCount: number;
  label: { en: string; zh: string } | null;
}) {
  return (
    <div
      className="absolute left-1/2 bottom-6 rounded-lg px-3 py-2 flex flex-col items-center gap-1.5"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
        zIndex: 55,
        transform: "translateX(-50%)",
      }}
    >
      <div className="flex items-center gap-1.5">
        {keys.map((k, i) => (
          <span
            key={i}
            className="rounded-md py-0.5 text-[12px] font-medium"
            style={{
              minWidth: 36,
              paddingInline: 6,
              textAlign: "center",
              background: i < visibleCount ? "var(--accent)" : "var(--surface)",
              color: i < visibleCount ? "var(--bg)" : "var(--text-faint)",
              border: `1px solid ${i < visibleCount ? "var(--accent)" : "var(--border)"}`,
              fontFamily: '"Geist Mono", monospace',
              transition: "color 150ms, background 150ms, border-color 150ms",
            }}
          >
            {k}
          </span>
        ))}
      </div>
      {label && (
        <div
          className="text-[10px]"
          style={{
            opacity: visibleCount >= 2 ? 1 : 0,
            transition: "opacity 150ms",
          }}
        >
          <Bi en={label.en} zh={label.zh} />
        </div>
      )}
    </div>
  );
}

function Timeline({
  current,
  completed,
  onSelect,
}: {
  current: number;
  completed: number;
  onSelect: (index: number) => void;
}) {
  const canPrev = current > 0;
  const canNext = current < PHASES.length - 1;
  const paused = completed >= current && canNext;
  return (
    <div className="shrink-0 flex items-center justify-between px-3 py-2 border-t border-[var(--border)]">
      <button
        className="rounded p-1 transition-colors duration-150"
        style={{
          color: canPrev ? "var(--text-secondary)" : "var(--text-faint)",
          background: canPrev ? "var(--surface)" : "transparent",
          cursor: canPrev ? "pointer" : "default",
        }}
        onClick={() => canPrev && onSelect(current - 1)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M7.5 2.5L4 6L7.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="flex items-center gap-1">
        {PHASES.map((phase, i) => (
          <button
            key={i}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors duration-150"
            style={{
              background: i === current ? "var(--surface-hover)" : "transparent",
              cursor: "pointer",
            }}
            onClick={() => onSelect(i)}
          >
            <div
              className="rounded-full shrink-0 transition-all duration-200"
              style={{
                width: 6,
                height: 6,
                background:
                  i === current
                    ? "var(--accent)"
                    : i <= completed
                      ? "var(--text-muted)"
                      : "var(--text-faint)",
              }}
            />
            <span
              className="text-[9px] hidden sm:inline"
              style={{
                color:
                  i === current
                    ? "var(--accent)"
                    : i <= completed
                      ? "var(--text-secondary)"
                      : "var(--text-faint)",
              }}
            >
              {phase.en}
            </span>
          </button>
        ))}
      </div>

      <button
        className="rounded p-1 transition-colors duration-150"
        style={{
          color: paused ? "var(--accent)" : canNext ? "var(--text-secondary)" : "var(--text-faint)",
          background: paused ? "var(--surface-hover)" : canNext ? "var(--surface)" : "transparent",
          cursor: canNext ? "pointer" : "default",
          animation: paused ? "demo-nudge 2s ease-in-out infinite" : "none",
        }}
        onClick={() => canNext && onSelect(current + 1)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

export function DemoAnimation({ autoplay = false, shortcuts }: DemoAnimationProps) {
  const mergedShortcuts = { ...DEFAULT_SHORTCUTS, ...shortcuts };
  const shortcutsRef = useRef(mergedShortcuts);
  shortcutsRef.current = mergedShortcuts;

  const canvasRef = useRef<HTMLDivElement>(null);
  // Refs for interactive click targets. Phases use these to compute
  // cursor positions via getBoundingClientRect instead of hardcoded
  // px coords — robust across container widths (welcome popup caps
  // at 800 px but the website can be narrower).
  const stageRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLDivElement | null>(null);
  const historyHeaderRef = useRef<HTMLDivElement | null>(null);
  const firstHistoryRowRef = useRef<HTMLDivElement | null>(null);
  const hotFileRowRef = useRef<HTMLDivElement | null>(null);
  const rightStripRef = useRef<HTMLDivElement | null>(null);

  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [cursorVisible, setCursorVisible] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [focusedTile, setFocusedTile] = useState(-1);
  const [tilesVisible, setTilesVisible] = useState([false, false, false, false]);
  const [canvasTransform, setCanvasTransform] = useState({ x: 0, y: 0, scale: 1 });
  // Both side panels default collapsed (thin strips with icons),
  // matching how the real app boots. Phases flip them to expanded
  // as the cursor interacts: phase 5 → left, phase 6 → right.
  const [leftPanelExpanded, setLeftPanelExpanded] = useState(false);
  const [rightPanelExpanded, setRightPanelExpanded] = useState(false);
  const [rightPanelTab] = useState<"files" | "diff" | "git">("files");
  const [hotFile, setHotFile] = useState<string | null>(null);
  const [monacoOpen, setMonacoOpen] = useState(false);
  // Left panel state.
  const [addProjectHot, setAddProjectHot] = useState(false);
  const [secondProjectShown, setSecondProjectShown] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyHot, setHistoryHot] = useState(-1);
  const [replayOpen, setReplayOpen] = useState(false);
  // Usage dashboard (shown during Done phase as a capstone).
  const [usageOpen, setUsageOpen] = useState(false);
  const [popupKeys, setPopupKeys] = useState<[string, string]>(["", ""]);
  const [popupVisible, setPopupVisible] = useState(0);
  const [popupLabel, setPopupLabel] = useState<{ en: string; zh: string } | null>(null);

  const [activePhase, setActivePhase] = useState(0);
  const [completedPhase, setCompletedPhase] = useState(-1);
  const runIdRef = useRef(0);

  const prefersReducedMotion = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  const getCanvasCenter = () => {
    const el = canvasRef.current;
    if (!el) return { x: 190, y: 190 };
    return { x: el.offsetLeft + el.clientWidth / 2, y: el.clientHeight / 2 };
  };

  const getTileCenter = (index: number) => {
    const center = getCanvasCenter();
    const off = TILE_OFFSETS[index];
    return { x: center.x + off.x, y: center.y + off.y };
  };
  void getTileCenter;

  const resetState = () => {
    setFocusedTile(-1);
    setTilesVisible([false, false, false, false]);
    setCanvasTransform({ x: 0, y: 0, scale: 1 });
    setPopupKeys(["", ""]);
    setPopupVisible(0);
    setPopupLabel(null);
    setLeftPanelExpanded(false);
    setRightPanelExpanded(false);
    setHotFile(null);
    setMonacoOpen(false);
    setAddProjectHot(false);
    setSecondProjectShown(false);
    setHistoryExpanded(false);
    setHistoryHot(-1);
    setReplayOpen(false);
    setUsageOpen(false);
    setIsDragging(false);
    setCursorVisible(false);
    setCursorPos(getCanvasCenter());
  };

  /**
   * Compute cursor coordinates (in the stage container's local
   * coord system) that land on the center of the given DOM element.
   * Returns `null` when the element isn't mounted yet.
   */
  const posOfElement = (
    el: HTMLElement | null,
  ): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!el || !stage) return null;
    const stageRect = stage.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    return {
      x: elRect.left - stageRect.left + elRect.width / 2,
      y: elRect.top - stageRect.top + elRect.height / 2,
    };
  };

  useEffect(() => {
    const id = ++runIdRef.current;
    const cancelled = () => runIdRef.current !== id;

    const delay = (ms: number) =>
      new Promise<void>((resolve) => { setTimeout(resolve, ms); });

    const sc = shortcutsRef.current;

    const showKeys = async (
      keys: [string, string],
      label: { en: string; zh: string },
    ) => {
      setPopupKeys(keys);
      setPopupVisible(0);
      setPopupLabel(label);
      await delay(150);
      if (cancelled()) return;
      setPopupVisible(1);
      await delay(250);
      if (cancelled()) return;
      setPopupVisible(2);
      await delay(400);
    };

    const clearKeys = () => {
      setPopupVisible(0);
    };

    const setupForPhase = (phase: number) => {
      setIsDragging(false);
      setCursorVisible(false);
      clearKeys();
      setMonacoOpen(false);
      setReplayOpen(false);
      setUsageOpen(false);
      if (phase === 0) {
        resetState();
      } else if (phase === 1) {
        setTilesVisible([true, true, true, true]);
        setFocusedTile(-1);
        setCanvasTransform({ x: 0, y: 0, scale: 1 });
        setLeftPanelExpanded(false);
        setRightPanelExpanded(false);
      } else if (phase === 2 || phase === 3) {
        setTilesVisible([true, true, true, true]);
        setFocusedTile(0);
        setCanvasTransform({ x: -TILE_OFFSETS[0].x, y: -TILE_OFFSETS[0].y, scale: 1.8 });
        setLeftPanelExpanded(false);
        setRightPanelExpanded(false);
      } else if (phase === 4) {
        setTilesVisible([true, true, true, true]);
        setFocusedTile(-1);
        setCanvasTransform({ x: 0, y: 0, scale: 1 });
        setLeftPanelExpanded(false);
        setRightPanelExpanded(false);
        setCursorVisible(true);
        setCursorPos(getCanvasCenter());
      } else if (phase === 5) {
        // Phase 5 setup: both panels still collapsed — we're about
        // to click the left panel's "+" which both adds a project
        // AND expands the panel.
        setTilesVisible([true, true, true, true]);
        setFocusedTile(-1);
        setCanvasTransform({ x: 0, y: 0, scale: 1 });
        setLeftPanelExpanded(false);
        setRightPanelExpanded(false);
        setAddProjectHot(false);
        setSecondProjectShown(false);
        setCursorVisible(true);
        setCursorPos(getCanvasCenter());
      } else if (phase === 6) {
        // Phase 6 setup: left panel stays expanded (carryover from
        // Phase 5) showing the two projects. Right panel still
        // collapsed — about to click its strip to expand.
        setTilesVisible([true, true, true, true]);
        setFocusedTile(-1);
        setCanvasTransform({ x: 0, y: 0, scale: 1 });
        setLeftPanelExpanded(true);
        setSecondProjectShown(true);
        setRightPanelExpanded(false);
        setHotFile(null);
        setHistoryExpanded(false);
        setHistoryHot(-1);
        setCursorVisible(true);
        setCursorPos(getCanvasCenter());
      } else if (phase === 7) {
        setTilesVisible([true, true, true, true]);
        setFocusedTile(-1);
        setCanvasTransform({ x: 0, y: 0, scale: 1 });
        setLeftPanelExpanded(true);
        setSecondProjectShown(true);
        setRightPanelExpanded(true);
        setHotFile(null);
        setHistoryExpanded(false);
        setHistoryHot(-1);
        setCursorVisible(true);
        setCursorPos(getCanvasCenter());
      } else if (phase === 8) {
        setTilesVisible([true, true, true, true]);
        setFocusedTile(-1);
        setCanvasTransform({ x: 0, y: 0, scale: 1 });
        setLeftPanelExpanded(true);
        setSecondProjectShown(true);
        setRightPanelExpanded(true);
        setHistoryExpanded(true);
        setHistoryHot(-1);
      }
    };

    const splitShortcut = (shortcut: string): [string, string] => {
      const parts = shortcut.split(/\s+/).filter(Boolean);
      return [parts[0] ?? "", parts[1] ?? ""];
    };

    const runPhase = async (phase: number) => {
      setupForPhase(phase);
      await delay(100);
      if (cancelled()) return;

      if (phase === 0) {
        for (let i = 0; i < 4; i++) {
          if (cancelled()) return;
          setTilesVisible((prev) => { const next = [...prev]; next[i] = true; return next; });
          await delay(150);
        }
        await delay(600);

      } else if (phase === 1) {
        await showKeys(splitShortcut(sc.clearFocus), { en: "Toggle Focus", zh: "切换聚焦" });
        if (cancelled()) return;
        setFocusedTile(0);
        setCanvasTransform({ x: -TILE_OFFSETS[0].x, y: -TILE_OFFSETS[0].y, scale: 1.8 });
        await delay(1200);

      } else if (phase === 2) {
        for (const idx of [1, 2]) {
          if (cancelled()) return;
          await showKeys(splitShortcut(sc.nextTerminal), { en: "Next Terminal", zh: "下一终端" });
          if (cancelled()) return;
          setFocusedTile(idx);
          setCanvasTransform({ x: -TILE_OFFSETS[idx].x, y: -TILE_OFFSETS[idx].y, scale: 1.8 });
          await delay(600);
        }
        for (const idx of [1, 0]) {
          if (cancelled()) return;
          await showKeys(splitShortcut(sc.prevTerminal), { en: "Prev Terminal", zh: "上一终端" });
          if (cancelled()) return;
          setFocusedTile(idx);
          setCanvasTransform({ x: -TILE_OFFSETS[idx].x, y: -TILE_OFFSETS[idx].y, scale: 1.8 });
          await delay(600);
        }
        await delay(600);

      } else if (phase === 3) {
        await showKeys(splitShortcut(sc.clearFocus), { en: "Toggle Focus", zh: "切换聚焦" });
        if (cancelled()) return;
        setFocusedTile(-1);
        setCanvasTransform({ x: 0, y: 0, scale: 1 });
        await delay(1200);

      } else if (phase === 4) {
        await showKeys(["Scroll", "↕"], { en: "Zoom", zh: "缩放" });
        if (cancelled()) return;
        setCanvasTransform({ x: 0, y: 0, scale: 0.7 });
        await delay(800);
        if (cancelled()) return;
        clearKeys();
        await delay(100);
        await showKeys(["Drag", "↔"], { en: "Pan", zh: "平移" });
        if (cancelled()) return;
        setCursorVisible(true);
        setIsDragging(true);
        const panCenter = getCanvasCenter();
        for (let i = 1; i <= 16; i++) {
          if (cancelled()) return;
          const progress = i / 16;
          const panX = Math.sin(progress * Math.PI) * 30;
          setCursorPos({ x: panCenter.x + panX, y: panCenter.y });
          setCanvasTransform({ x: panX, y: 0, scale: 0.7 });
          await delay(25);
        }
        setIsDragging(false);
        if (cancelled()) return;
        clearKeys();
        await delay(100);
        await showKeys(["Scroll", "↕"], { en: "Zoom", zh: "缩放" });
        if (cancelled()) return;
        setCanvasTransform({ x: 0, y: 0, scale: 1 });
        setCursorPos(panCenter);
        await delay(800);

      } else if (phase === 5) {
        // Phase 5 — Project. Left panel starts collapsed (32-px
        // strip). Cursor goes to its "+" button, clicks:
        //   1. panel expands to 140 px
        //   2. a second project slides into the tree
        setCursorVisible(true);
        setCursorPos(getCanvasCenter());
        await delay(250);
        if (cancelled()) return;
        const addTarget = posOfElement(addButtonRef.current);
        if (addTarget) setCursorPos(addTarget);
        await showKeys(splitShortcut(sc.addProject), { en: "Add Project", zh: "添加项目" });
        if (cancelled()) return;
        setAddProjectHot(true);
        await delay(350);
        if (cancelled()) return;
        setLeftPanelExpanded(true);
        await delay(450);
        if (cancelled()) return;
        setSecondProjectShown(true);
        await delay(900);
        if (cancelled()) return;
        setAddProjectHot(false);
        await delay(400);

      } else if (phase === 6) {
        // Phase 6 — Code. Right panel starts collapsed. Cursor
        // goes to its strip, clicks:
        //   1. right panel expands to 140 px
        //   2. cursor moves to a file row
        //   3. Monaco drawer slides in from the right
        setCursorVisible(true);
        setCursorPos(getCanvasCenter());
        await delay(250);
        if (cancelled()) return;
        const stripTarget = posOfElement(rightStripRef.current);
        if (stripTarget) setCursorPos(stripTarget);
        await showKeys(["Click", "单击"], { en: "Files tab", zh: "文件面板" });
        if (cancelled()) return;
        setRightPanelExpanded(true);
        await delay(450);
        if (cancelled()) return;
        const fileTarget = posOfElement(hotFileRowRef.current);
        if (fileTarget) setCursorPos(fileTarget);
        await delay(350);
        if (cancelled()) return;
        setHotFile("FileEditorDrawer.tsx");
        await delay(200);
        if (cancelled()) return;
        setMonacoOpen(true);
        await delay(1600);

      } else if (phase === 7) {
        // Phase 7 — Replay. Cursor moves to the bottom of the left
        // panel where the History header sits, triggers it to
        // expand, then clicks the first row. Both coords measured
        // from refs — the History section is pushed to the bottom
        // by `mt-auto` so its y depends on panel height.
        setCursorVisible(true);
        setCursorPos(getCanvasCenter());
        await delay(250);
        if (cancelled()) return;
        const headerTarget = posOfElement(historyHeaderRef.current);
        if (headerTarget) setCursorPos(headerTarget);
        await delay(450);
        if (cancelled()) return;
        setHistoryExpanded(true);
        await delay(350);
        if (cancelled()) return;
        const rowTarget = posOfElement(firstHistoryRowRef.current);
        if (rowTarget) setCursorPos(rowTarget);
        await delay(400);
        if (cancelled()) return;
        setHistoryHot(0);
        await showKeys(["Click", "单击"], { en: "Open Replay", zh: "打开回放" });
        if (cancelled()) return;
        setReplayOpen(true);
        await delay(1600);

      } else if (phase === 8) {
        // Phase 8 — Done. Replay drawer closes (setup) and the
        // Usage dashboard fades in via the shortcut. Demonstrates
        // the canvas-gap mutual-exclusion: same slot, different
        // tenant.
        await showKeys(splitShortcut(sc.openUsage), { en: "Open Usage", zh: "打开用量" });
        if (cancelled()) return;
        setUsageOpen(true);
        await delay(1800);
      }

      if (!cancelled()) {
        setCompletedPhase((prev) => Math.max(prev, phase));
      }
    };

    if (prefersReducedMotion.current) {
      setTilesVisible([true, true, true, true]);
      setCursorPos(getCanvasCenter());
      setCompletedPhase(PHASES.length - 1);
      return;
    }

    runPhase(activePhase);
  }, [activePhase]);

  const handleSelectPhase = (index: number) => {
    runIdRef.current++;
    setActivePhase(index);
  };

  useEffect(() => {
    if (!autoplay) return;
    if (completedPhase < activePhase) return;
    const timer = setTimeout(() => {
      if (activePhase < PHASES.length - 1) {
        handleSelectPhase(activePhase + 1);
      } else {
        setCompletedPhase(-1);
        handleSelectPhase(0);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [autoplay, completedPhase, activePhase]);

  useEffect(() => {
    const handler = () => {
      if (document.hidden) {
        runIdRef.current++;
      } else {
        handleSelectPhase(activePhase);
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [activePhase]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && activePhase < PHASES.length - 1) {
        e.preventDefault();
        handleSelectPhase(activePhase + 1);
      } else if (e.key === "ArrowLeft" && activePhase > 0) {
        e.preventDefault();
        handleSelectPhase(activePhase - 1);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [activePhase]);

  return (
    <>
      <div ref={stageRef} className="flex flex-1 min-h-0 relative">
        <DemoLeftPanel
          expanded={leftPanelExpanded}
          addProjectHot={addProjectHot}
          historyHot={historyHot}
          showSecondProject={secondProjectShown}
          historyExpanded={historyExpanded}
          addButtonRef={addButtonRef}
          historyHeaderRef={historyHeaderRef}
          firstHistoryRowRef={firstHistoryRowRef}
        />

        <div className="flex-1 min-w-0 flex flex-col">
          <div
            ref={canvasRef}
            className="relative overflow-hidden"
            style={{
              height: 380,
              minHeight: 380,
              background: "var(--surface)",
              backgroundImage:
                "radial-gradient(circle, var(--border) 0.5px, transparent 0.5px)",
              backgroundSize: "20px 20px",
            }}
          >
            {!autoplay && completedPhase >= activePhase && activePhase < PHASES.length - 1 && (
              <div
                className="absolute top-2.5 left-3 text-[13px]"
                style={{ color: "var(--text-muted)", zIndex: 10 }}
              >
                ← prev · next →
              </div>
            )}
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                transform: `translate(${canvasTransform.x}px, ${canvasTransform.y}px) scale(${canvasTransform.scale})`,
                transition: isDragging ? "none" : "transform 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
              }}
            >
              <div
                className="rounded-md border"
                style={{
                  background: "var(--bg)",
                  borderColor: "var(--border)",
                }}
              >
                <div
                  className="flex items-center gap-1.5 px-2 py-1 border-b"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span className="text-[7px] font-medium" style={{ color: "var(--accent)" }}>
                    PROJECT
                  </span>
                  <span className="text-[8px] text-[var(--text-secondary)]">termcanvas</span>
                </div>
                <div className="p-1.5">
                  <div
                    className="rounded border px-1.5 pt-1 pb-1.5"
                    style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <div className="w-[3px] h-[5px] rounded-full" style={{ background: "var(--green)" }} />
                      <span className="text-[7px] text-[var(--text-muted)]">main</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {TERMINALS.map((term, i) => (
                        <DemoTile
                          key={term.name}
                          name={term.name}
                          color={term.color}
                          lines={[...term.lines]}
                          focused={focusedTile === i}
                          visible={tilesVisible[i]}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Canvas-gap drawers — Monaco (right-anchored), Replay
                (left-anchored), Usage (full canvas). All three
                occupy the same slot in the real app; the demo
                only shows one at a time per phase. Rendered inside
                the canvas div so `left: 0` / `right: 0` line up
                flush with the two side panels automatically. */}
            <DemoMonacoDrawer open={monacoOpen} />
            <DemoReplayDrawer open={replayOpen} />
            <DemoUsagePanel open={usageOpen} />

            <KeystrokePopup keys={popupKeys} visibleCount={popupVisible} label={popupLabel} />
          </div>
        </div>

        <DemoRightPanel
          expanded={rightPanelExpanded}
          activeTab={rightPanelTab}
          hotFile={hotFile}
          hotFileRef={hotFileRowRef}
          stripRef={rightStripRef}
        />
        <DemoCursor pos={cursorPos} dragging={isDragging} visible={cursorVisible} />
      </div>

      {!autoplay && (
        <Timeline
          current={activePhase}
          completed={completedPhase}
          onSelect={handleSelectPhase}
        />
      )}
    </>
  );
}
