import { useState, useEffect, useRef } from "react";

export interface DemoAnimationProps {
  autoplay?: boolean;
  shortcuts?: {
    clearFocus: string;
    nextTerminal: string;
    prevTerminal: string;
    addProject: string;
  };
}

const DEFAULT_SHORTCUTS = {
  clearFocus: "⌘ E",
  nextTerminal: "⌘ ]",
  prevTerminal: "⌘ [",
  addProject: "⌘ O",
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
  { en: "Sidebar", zh: "侧栏" },
  { en: "Panel", zh: "面板" },
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

function DemoSidebar({ expanded, activeTab }: { expanded: boolean; activeTab: "files" | "git" }) {
  return (
    <div
      className="shrink-0 flex flex-col border-r border-[var(--border)] overflow-hidden"
      style={{
        width: expanded ? 150 : 32,
        background: "var(--sidebar)",
        transition: "width 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      }}
    >
      {expanded ? (
        <div className="flex flex-col h-full" style={{ width: 150 }}>
          <div className="flex gap-0.5 p-1 mx-1 mt-1.5 rounded-md" style={{ background: "var(--bg)" }}>
            {[{ key: "files", label: "Files" }, { key: "git", label: "Git" }].map((tab) => (
              <div
                key={tab.key}
                className="flex-1 text-center py-0.5 rounded text-[8px]"
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
          {activeTab === "files" ? (
            <div className="flex-1 min-h-0 px-1.5 pt-2 flex flex-col gap-0.5 overflow-hidden">
              <div className="flex items-center gap-1">
                <span className="text-[7px]" style={{ color: "var(--accent)" }}>▼</span>
                <span className="text-[8px] font-medium" style={{ color: "var(--text-secondary)" }}>src</span>
              </div>
              {["main.ts", "app.tsx", "index.css", "layout.ts", "types.ts"].map((f) => (
                <div key={f} className="pl-3 flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full" style={{ background: "var(--text-faint)" }} />
                  <span className="text-[7px] text-[var(--text-muted)]">{f}</span>
                </div>
              ))}
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[7px]" style={{ color: "var(--accent)" }}>▼</span>
                <span className="text-[8px] font-medium" style={{ color: "var(--text-secondary)" }}>components</span>
              </div>
              {["App.tsx", "Hub.tsx", "Panel.tsx"].map((f) => (
                <div key={f} className="pl-3 flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full" style={{ background: "var(--text-faint)" }} />
                  <span className="text-[7px] text-[var(--text-muted)]">{f}</span>
                </div>
              ))}
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[7px]" style={{ color: "var(--text-faint)" }}>▶</span>
                <span className="text-[8px]" style={{ color: "var(--text-secondary)" }}>stores</span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[7px]" style={{ color: "var(--text-faint)" }}>▶</span>
                <span className="text-[8px]" style={{ color: "var(--text-secondary)" }}>tests</span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[7px]" style={{ color: "var(--text-faint)" }}>▶</span>
                <span className="text-[8px]" style={{ color: "var(--text-secondary)" }}>hooks</span>
              </div>
              <div className="mt-1.5 flex flex-col gap-0.5">
                {["package.json", "tsconfig.json", "vite.config.ts", ".gitignore", "README.md"].map((f) => (
                  <div key={f} className="flex items-center gap-1">
                    <div className="w-1 h-1 rounded-full" style={{ background: "var(--text-faint)" }} />
                    <span className="text-[7px] text-[var(--text-muted)]">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 px-1.5 pt-2 flex flex-col gap-1.5 overflow-hidden">
              <div>
                <span className="text-[7px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Branch
                </span>
                <div className="mt-0.5 flex items-center gap-1 px-1 py-0.5 rounded" style={{ background: "var(--surface)" }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--green)" }} />
                  <span className="text-[8px] font-medium" style={{ color: "var(--text-primary)" }}>main</span>
                </div>
              </div>

              <div>
                <span className="text-[7px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Status
                </span>
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {[
                    { file: "app.tsx", badge: "M", color: "var(--amber)" },
                    { file: "index.css", badge: "M", color: "var(--amber)" },
                    { file: "utils.ts", badge: "A", color: "var(--green)" },
                  ].map((f) => (
                    <div key={f.file} className="flex items-center gap-1">
                      <span
                        className="text-[6px] font-bold rounded px-0.5"
                        style={{ background: f.color, color: "var(--bg)", minWidth: 10, textAlign: "center" }}
                      >
                        {f.badge}
                      </span>
                      <span className="text-[7px] text-[var(--text-muted)]">{f.file}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[7px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Commits
                </span>
                <div className="mt-0.5 flex flex-col gap-1">
                  {[
                    { hash: "a3f21c", msg: "feat: add panel", time: "2m" },
                    { hash: "8d4e0b", msg: "fix: layout shift", time: "18m" },
                    { hash: "c72a1f", msg: "refactor: stores", time: "1h" },
                    { hash: "19be3d", msg: "chore: deps update", time: "3h" },
                    { hash: "f0c84a", msg: "feat: sidebar tabs", time: "5h" },
                    { hash: "6e21b7", msg: "fix: scroll reset", time: "8h" },
                  ].map((c) => (
                    <div key={c.hash} className="flex flex-col">
                      <div className="flex items-center gap-1">
                        <span className="text-[7px] font-medium" style={{ color: "var(--accent)", fontFamily: '"Geist Mono", monospace' }}>
                          {c.hash}
                        </span>
                        <span className="text-[6px]" style={{ color: "var(--text-faint)" }}>{c.time}</span>
                      </div>
                      <span className="text-[7px] text-[var(--text-muted)] truncate">{c.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center pt-2 gap-1.5" style={{ width: 32 }}>
          {[
            { color: "var(--accent)", active: true },
            { color: "var(--text-muted)", active: false },
            { color: "var(--text-muted)", active: false },
            { color: "var(--text-muted)", active: false },
          ].map((item, i) => (
            <div
              key={i}
              className="rounded"
              style={{
                width: 14,
                height: 14,
                background: item.active ? "var(--surface-hover)" : "transparent",
                border: `1px solid ${item.active ? "var(--border)" : "transparent"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                className="rounded-sm"
                style={{ width: 8, height: 8, background: item.color, opacity: item.active ? 1 : 0.4 }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DemoProjectContainer({ visible }: { visible: boolean }) {
  return (
    <div
      className="absolute rounded-md border"
      style={{
        right: 24,
        top: 24,
        width: 160,
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1) translateY(0)" : "scale(0.9) translateY(8px)",
        transition: "all 300ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        background: "var(--bg)",
        borderColor: visible ? "var(--accent)" : "var(--border)",
        boxShadow: visible ? "0 0 12px rgba(91,158,245,0.3)" : "none",
        zIndex: 45,
      }}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-[7px] font-medium" style={{ color: "var(--accent)" }}>
          PROJECT
        </span>
        <span className="text-[8px] text-[var(--text-secondary)]">my-app</span>
      </div>
      <div className="p-1.5 flex flex-col gap-1">
        <div
          className="rounded border px-1.5 py-1"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="flex items-center gap-1 mb-1">
            <div className="w-[3px] h-[5px] rounded-full" style={{ background: "var(--cyan)" }} />
            <span className="text-[7px] text-[var(--text-muted)]">main</span>
          </div>
          <div className="rounded" style={{ height: 20, background: "var(--surface-hover)", opacity: 0.5 }} />
        </div>
        <div
          className="rounded border px-1.5 py-1"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="flex items-center gap-1">
            <div className="w-[3px] h-[5px] rounded-full" style={{ background: "var(--amber)" }} />
            <span className="text-[7px] text-[var(--text-muted)]">feat/login</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoPanel({
  visible,
  content,
}: {
  visible: boolean;
  content: "usage" | "hydra";
}) {
  return (
    <div className="shrink-0 overflow-hidden" style={{ width: visible ? 180 : 0, transition: "width 300ms ease-out" }}>
      <div
        className="h-full border-l border-[var(--border)]"
        style={{
          width: 180,
          background: "var(--surface)",
          transform: visible ? "translateX(0)" : "translateX(100%)",
          transition:
            "transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {content === "usage" ? (
          <div className="p-3 flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[7px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Today
              </span>
              <span className="text-[14px] font-semibold" style={{ color: "var(--amber)", fontFamily: '"Geist Mono", monospace' }}>
                $4.82
              </span>
            </div>

            <div className="flex items-end gap-[3px]" style={{ height: 48 }}>
              {[12, 18, 14, 22, 28, 20, 35, 30, 42, 38, 48, 44].map((h, i) => (
                <div
                  key={i}
                  className="rounded-sm flex-1"
                  style={{
                    height: h,
                    background: i >= 10 ? "var(--amber)" : "var(--accent)",
                    opacity: 0.25 + (i / 12) * 0.5,
                  }}
                />
              ))}
            </div>

            <div className="flex items-center justify-between" style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
              <span className="text-[7px]" style={{ color: "var(--text-muted)" }}>Tokens</span>
              <span className="text-[8px] font-medium" style={{ color: "var(--text-secondary)", fontFamily: '"Geist Mono", monospace' }}>
                128.4k
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              {[
                { label: "opus", pct: 72, color: "var(--accent)" },
                { label: "sonnet", pct: 45, color: "var(--cyan)" },
                { label: "haiku", pct: 18, color: "var(--green)" },
              ].map((m) => (
                <div key={m.label} className="flex items-center gap-1.5">
                  <span className="text-[7px] w-8 text-right" style={{ color: "var(--text-muted)" }}>{m.label}</span>
                  <div className="flex-1 rounded-full overflow-hidden" style={{ height: 4, background: "var(--border)" }}>
                    <div className="h-full rounded-full" style={{ width: `${m.pct}%`, background: m.color, opacity: 0.7 }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between" style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
              <span className="text-[7px]" style={{ color: "var(--text-muted)" }}>This week</span>
              <span className="text-[9px] font-medium" style={{ color: "var(--text-secondary)", fontFamily: '"Geist Mono", monospace' }}>
                $31.50
              </span>
            </div>

            <div className="flex flex-col gap-1" style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
              <span className="text-[7px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Sessions
              </span>
              {[
                { time: "2m ago", tokens: "12.1k", cost: "$0.48" },
                { time: "18m ago", tokens: "8.7k", cost: "$0.31" },
                { time: "1h ago", tokens: "24.3k", cost: "$1.02" },
                { time: "3h ago", tokens: "6.2k", cost: "$0.22" },
              ].map((s, i) => (
                <div key={i} className="flex items-center justify-between py-0.5">
                  <span className="text-[7px]" style={{ color: "var(--text-faint)" }}>{s.time}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[7px]" style={{ color: "var(--text-muted)" }}>{s.tokens}</span>
                    <span className="text-[7px] font-medium" style={{ color: "var(--text-secondary)", fontFamily: '"Geist Mono", monospace' }}>{s.cost}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-end gap-[2px]" style={{ borderTop: "1px solid var(--border)", paddingTop: 6, height: 32 }}>
              {[3, 5, 4, 8, 6, 10, 7, 12, 9, 14, 11, 16, 13, 18, 20, 15, 22, 19, 24, 21, 28, 25].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm"
                  style={{
                    height: h,
                    background: "var(--cyan)",
                    opacity: 0.15 + (i / 22) * 0.35,
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="p-3 flex flex-col gap-3">
            {[0.5, 0.4].map((op, i) => (
              <div
                key={i}
                className="rounded-full"
                style={{
                  height: 14,
                  width: i === 0 ? "70%" : "50%",
                  background: "var(--green)",
                  opacity: op,
                }}
              />
            ))}
            <div
              className="rounded-full"
              style={{
                height: 6,
                width: "100%",
                background: "var(--text-faint)",
                opacity: 0.3,
                overflow: "hidden",
              }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: "65%",
                  background: "var(--accent)",
                  opacity: 0.6,
                }}
              />
            </div>
          </div>
        )}
      </div>
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

  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [cursorVisible, setCursorVisible] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [focusedTile, setFocusedTile] = useState(-1);
  const [tilesVisible, setTilesVisible] = useState([false, false, false, false]);
  const [canvasTransform, setCanvasTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [panelVisible, setPanelVisible] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"files" | "git">("files");
  const [newProject, setNewProject] = useState(false);
  const [panelContent, setPanelContent] = useState<"usage" | "hydra">("usage");
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
    setPanelVisible(false);
    setSidebarExpanded(false);
    setSidebarTab("files");
    setNewProject(false);
    setPanelContent("usage");
    setIsDragging(false);
    setCursorVisible(false);
    setCursorPos(getCanvasCenter());
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
      setPanelContent("usage");
      if (phase === 0) {
        resetState();
      } else if (phase === 1) {
        setTilesVisible([true, true, true, true]);
        setFocusedTile(-1);
        setCanvasTransform({ x: 0, y: 0, scale: 1 });
        setPanelVisible(false);
      } else if (phase === 2) {
        setTilesVisible([true, true, true, true]);
        setFocusedTile(0);
        setCanvasTransform({ x: -TILE_OFFSETS[0].x, y: -TILE_OFFSETS[0].y, scale: 1.8 });
        setPanelVisible(false);
      } else if (phase === 3) {
        setTilesVisible([true, true, true, true]);
        setFocusedTile(0);
        setCanvasTransform({ x: -TILE_OFFSETS[0].x, y: -TILE_OFFSETS[0].y, scale: 1.8 });
        setPanelVisible(false);
      } else if (phase >= 4 && phase <= 7) {
        setTilesVisible([true, true, true, true]);
        setFocusedTile(-1);
        setCanvasTransform({ x: 0, y: 0, scale: 1 });
        setSidebarExpanded(phase >= 6);
        setPanelVisible(phase === 7);
        setNewProject(false);
        setCursorVisible(phase === 4 || phase === 5 || phase === 6);
        if (phase === 4) setCursorPos(getCanvasCenter());
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
        setCursorVisible(true);
        setSidebarTab("files");
        setCursorPos({ x: 16, y: 100 });
        await delay(800);
        if (cancelled()) return;
        setSidebarExpanded(true);
        await delay(1500);
        if (cancelled()) return;
        setCursorPos({ x: 115, y: 12 });
        await delay(700);
        if (cancelled()) return;
        setSidebarTab("git");
        await delay(1500);

      } else if (phase === 6) {
        setCursorVisible(true);
        const el = canvasRef.current;
        const rightEdge = el ? el.offsetLeft + el.clientWidth - 10 : 400;
        setCursorPos({ x: rightEdge, y: 100 });
        await delay(800);
        if (cancelled()) return;
        setPanelVisible(true);
        setPanelContent("usage");
        await delay(2000);

      } else if (phase === 7) {
        setSidebarExpanded(false);
        setPanelVisible(false);
        await delay(400);
        if (cancelled()) return;
        await showKeys(splitShortcut(sc.addProject), { en: "Add Project", zh: "添加项目" });
        if (cancelled()) return;
        setNewProject(true);
        await delay(1200);
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
      <div className="flex flex-1 min-h-0 relative">
        <DemoSidebar expanded={sidebarExpanded} activeTab={sidebarTab} />

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

            <DemoProjectContainer visible={newProject} />
            <KeystrokePopup keys={popupKeys} visibleCount={popupVisible} label={popupLabel} />
          </div>
        </div>

        <DemoPanel visible={panelVisible} content={panelContent} />
        <DemoCursor pos={cursorPos} dragging={isDragging} visible={cursorVisible} />
      </div>

      <Timeline
        current={activePhase}
        completed={completedPhase}
        onSelect={handleSelectPhase}
      />
    </>
  );
}
