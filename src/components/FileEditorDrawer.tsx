import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useThemeStore } from "../stores/themeStore";
import { useT } from "../i18n/useT";
import type * as MonacoNs from "monaco-editor";

/*
 * Full-canvas file editor drawer.
 *
 * Slides in from the right over the right panel + canvas. Two levels:
 *   level-1 (default): 60% of viewport width — right panel fully
 *                      covered, canvas still half-visible so you can
 *                      see terminals running while reading code.
 *   level-2 (expanded): full area minus the left panel — immersive.
 *
 * The left panel is deliberately NOT covered: project navigation stays
 * reachable so switching files doesn't require closing the drawer.
 *
 * Monaco is heavy (~1 MB gzipped) — lazy-loaded via React.lazy so cold
 * start stays light. Until the user opens their first file, Monaco
 * isn't downloaded at all.
 */
const MonacoEditor = lazy(async () => {
  // Load monaco core + the React wrapper in parallel, then point the
  // React wrapper's loader at the local copy (default fetches from
  // jsdelivr CDN — wrong for Electron: offline-flaky + CSP surface).
  const [monacoMod, reactMod] = await Promise.all([
    import("monaco-editor"),
    import("@monaco-editor/react"),
  ]);
  reactMod.loader.config({ monaco: monacoMod });

  // Register app-tinted Monaco themes. vs-dark's #1e1e1e and vs's
  // white don't match our palette (warm charcoal / warm cream) —
  // inherit the tokenisation from the base themes and only override
  // the structural colours (bg / gutter / selection / border). Keeps
  // syntax highlighting intact, drops the mismatched chrome.
  monacoMod.editor.defineTheme("termcanvas-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#1a1918",
      "editor.foreground": "#e4e2df",
      "editorLineNumber.foreground": "#5a5754",
      "editorLineNumber.activeForeground": "#918e89",
      "editor.lineHighlightBackground": "#222120",
      "editor.lineHighlightBorder": "#00000000",
      "editorCursor.foreground": "#e4e2df",
      "editor.selectionBackground": "#5b9ef540",
      "editor.inactiveSelectionBackground": "#5b9ef525",
      "editor.selectionHighlightBackground": "#5b9ef520",
      "editor.wordHighlightBackground": "#5b9ef518",
      "editor.findMatchBackground": "#d4a24e55",
      "editor.findMatchHighlightBackground": "#d4a24e25",
      "editorGutter.background": "#1a1918",
      "editorWidget.background": "#222120",
      "editorWidget.border": "#333231",
      "editorIndentGuide.background": "#333231",
      "editorIndentGuide.activeBackground": "#43423f",
      "editorBracketMatch.background": "#5b9ef520",
      "editorBracketMatch.border": "#5b9ef555",
      "scrollbarSlider.background": "#43423f55",
      "scrollbarSlider.hoverBackground": "#43423f90",
      "scrollbarSlider.activeBackground": "#43423fcc",
    },
  });
  monacoMod.editor.defineTheme("termcanvas-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#eae8e4",
      "editor.foreground": "#1c1917",
      "editorLineNumber.foreground": "#a8a39b",
      "editorLineNumber.activeForeground": "#57534e",
      "editor.lineHighlightBackground": "#f3f2ef",
      "editor.lineHighlightBorder": "#00000000",
      "editorCursor.foreground": "#1c1917",
      "editor.selectionBackground": "#2563eb30",
      "editor.inactiveSelectionBackground": "#2563eb18",
      "editor.selectionHighlightBackground": "#2563eb15",
      "editor.wordHighlightBackground": "#2563eb12",
      "editor.findMatchBackground": "#d9770655",
      "editor.findMatchHighlightBackground": "#d9770625",
      "editorGutter.background": "#eae8e4",
      "editorWidget.background": "#f3f2ef",
      "editorWidget.border": "#dbd8d3",
      "editorIndentGuide.background": "#dbd8d3",
      "editorIndentGuide.activeBackground": "#c9c5bf",
      "editorBracketMatch.background": "#2563eb18",
      "editorBracketMatch.border": "#2563eb55",
      "scrollbarSlider.background": "#c9c5bf55",
      "scrollbarSlider.hoverBackground": "#c9c5bf90",
      "scrollbarSlider.activeBackground": "#c9c5bfcc",
    },
  });

  return { default: reactMod.default };
});

// Toolbar height above which the drawer starts. Keep in sync with
// App.tsx's Toolbar.
const TOOLBAR_HEIGHT = 44;

function guessLanguage(path: string): string {
  const lower = path.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf(".") + 1);
  // Deliberately narrow — the set matches Monaco's built-in language
  // services we ship via monacoEnvironment.ts. Unknown extensions fall
  // through to "plaintext" (still syntax-coloured as plain text, no
  // IntelliSense).
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    jsonc: "json",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    htm: "html",
    md: "markdown",
    markdown: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    rb: "ruby",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    ini: "ini",
    xml: "xml",
    sql: "sql",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
  };
  return map[ext] ?? "plaintext";
}

interface FileReadSuccess {
  content: string;
  type?: string;
}
interface FileReadError {
  error: string;
}
type FileReadResult = FileReadSuccess | FileReadError;

function isReadSuccess(r: FileReadResult): r is FileReadSuccess {
  return "content" in r;
}

export function FileEditorDrawer() {
  const t = useT();
  const path = useCanvasStore((s) => s.fileEditorPath);
  const expanded = useCanvasStore((s) => s.fileEditorExpanded);
  const close = useCanvasStore((s) => s.closeFileEditor);
  const toggleExpanded = useCanvasStore((s) => s.toggleFileEditorExpanded);
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const rightPanelWidth = useCanvasStore((s) => s.rightPanelWidth);
  const theme = useThemeStore((s) => s.theme);

  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const editorRef = useRef<MonacoNs.editor.IStandaloneCodeEditor | null>(null);

  const dirty = content !== originalContent;
  const open = path !== null;

  // Load file when path changes.
  useEffect(() => {
    if (!path || !window.termcanvas) {
      setContent("");
      setOriginalContent("");
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    window.termcanvas.fs
      .readFile(path)
      .then((result: FileReadResult) => {
        if (cancelled) return;
        if (isReadSuccess(result)) {
          setContent(result.content);
          setOriginalContent(result.content);
        } else {
          setContent("");
          setOriginalContent("");
          setLoadError(result.error || "read failed");
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setContent("");
        setOriginalContent("");
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const handleSave = useCallback(async () => {
    if (!path || !dirty || saving) return;
    setSaving(true);
    try {
      await window.termcanvas.fs.writeFile(path, content);
      setOriginalContent(content);
    } finally {
      setSaving(false);
    }
  }, [path, content, dirty, saving]);

  const handleClose = useCallback(() => {
    if (
      dirty &&
      !window.confirm(t.file_editor_discard_confirm ?? "Discard unsaved changes?")
    ) {
      return;
    }
    close();
  }, [dirty, close, t]);

  // Cmd/Ctrl+S to save, Esc to close — bound at window level while
  // the drawer is open. Capture phase so Monaco's internal shortcut
  // binding doesn't eat Cmd+S first.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        void handleSave();
      } else if (e.key === "Escape") {
        // Don't swallow Esc if Monaco has a dialog open (find/replace
        // widget). Cheap heuristic: only close when the focused
        // element is the editor itself or outside.
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, handleSave, handleClose]);

  if (!open || !path) return null;

  const leftInset = leftPanelCollapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth;
  const rightInset = rightPanelCollapsed
    ? COLLAPSED_TAB_WIDTH
    : rightPanelWidth;
  // Drawer is anchored so its RIGHT edge sits flush against the
  // LEFT edge of the right panel — the drawer pulls out from the
  // right panel's seam, leaving that panel fully visible so the
  // user can keep browsing Files/Diff/Git while reading code.
  //
  // Level-1 width: 55% of viewport width, but never wider than the
  // actual canvas gap (leftInset + rightInset subtracted). On tight
  // layouts this naturally shrinks.
  // Level-2 width: fills the entire gap between the two panels.
  const gapMax = `calc(100vw - ${leftInset}px - ${rightInset}px)`;
  const widthStyle = expanded
    ? gapMax
    : `min(55vw, ${gapMax})`;

  const fileName = path.split("/").pop() ?? path;
  const relPath = path;

  return (
    <div
      className="fixed z-50 bg-[var(--bg)] border-l border-r border-[var(--border)] shadow-2xl flex flex-col"
      style={{
        top: TOOLBAR_HEIGHT,
        right: rightInset,
        height: `calc(100vh - ${TOOLBAR_HEIGHT}px)`,
        width: widthStyle,
        transition:
          "width 180ms cubic-bezier(0.4, 0, 0.2, 1), right 180ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      role="dialog"
      aria-modal="false"
      aria-label={fileName}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span
            className="text-[12px] font-medium text-[var(--text-primary)] truncate"
            style={{ fontFamily: '"Geist Mono", monospace' }}
            title={relPath}
          >
            {fileName}
          </span>
          {dirty && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0"
              title={t.file_editor_dirty ?? "Unsaved changes"}
            />
          )}
          <span
            className="text-[10px] text-[var(--text-faint)] truncate"
            style={{ fontFamily: '"Geist Mono", monospace' }}
            title={relPath}
          >
            {relPath}
          </span>
        </div>

        <button
          className="flex items-center gap-1 px-2 h-6 rounded-md text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          title={t.file_editor_save ?? "Save (⌘S)"}
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {saving
            ? t.file_editor_saving ?? "saving…"
            : t.file_editor_save ?? "Save"}
        </button>

        <button
          className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
          onClick={toggleExpanded}
          title={
            expanded
              ? t.file_editor_restore ?? "Restore"
              : t.file_editor_maximize ?? "Maximize"
          }
        >
          {expanded ? (
            // "Restore" glyph — two offset rectangles
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect
                x="3.5"
                y="1.5"
                width="6"
                height="6"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1.1"
              />
              <rect
                x="1.5"
                y="4.5"
                width="6"
                height="6"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1.1"
                fill="var(--surface)"
              />
            </svg>
          ) : (
            // "Maximize" glyph — single rectangle
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect
                x="1.5"
                y="1.5"
                width="9"
                height="9"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1.1"
              />
            </svg>
          )}
        </button>

        <button
          className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
          onClick={handleClose}
          title={t.file_editor_close ?? "Close (Esc)"}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[var(--text-faint)]">
            {t.loading}
          </div>
        )}
        {loadError && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[var(--red)]">
            {loadError}
          </div>
        )}
        {!loadError && (
          <Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[var(--text-faint)]">
                {t.loading}
              </div>
            }
          >
            <MonacoEditor
              path={path}
              value={content}
              language={guessLanguage(path)}
              theme={theme === "dark" ? "termcanvas-dark" : "termcanvas-light"}
              onChange={(v) => setContent(v ?? "")}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                // Re-register Cmd+S inside Monaco so the editor's
                // default "show keybindings" shortcut (Cmd+K-chain)
                // doesn't intercept save-style chords.
                editor.addCommand(
                  monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                  () => void handleSave(),
                );
              }}
              options={{
                fontFamily: '"Geist Mono", monospace',
                fontSize: 13,
                lineHeight: 20,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                renderLineHighlight: "gutter",
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "off",
                smoothScrolling: true,
                cursorSmoothCaretAnimation: "on",
                padding: { top: 12, bottom: 12 },
                bracketPairColorization: { enabled: true },
              }}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
