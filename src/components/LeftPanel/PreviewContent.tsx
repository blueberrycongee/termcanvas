import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { marked } from "marked";
import { useT } from "../../i18n/useT";

interface Props {
  filePath: string | null;
  onClose: () => void;
  onNavigate?: (filePath: string) => void;
}

export function PreviewContent({ filePath, onClose, onNavigate }: Props) {
  const t = useT();
  const [content, setContent] = useState<string>("");
  const [fileType, setFileType] = useState<string>("text");
  const [loading, setLoading] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const originalContentRef = useRef<string>("");

  useEffect(() => {
    if (!filePath || !window.termcanvas) {
      setContent("");
      return;
    }

    setLoading(true);
    setEditing(false);
    window.termcanvas.fs.readFile(filePath).then((result) => {
      if ("content" in result) {
        setContent(result.content);
        originalContentRef.current = result.content;
        setFileType("type" in result ? (result as { type: string }).type : "text");
      } else {
        setContent("");
        originalContentRef.current = "";
        setFileType("text");
      }
      setLoading(false);
    }).catch(() => {
      setContent("");
      originalContentRef.current = "";
      setFileType("text");
      setLoading(false);
    });
  }, [filePath]);

  const isMarkdown = fileType === "markdown";
  const isEditable = fileType === "text" || fileType === "markdown";

  const markdownHtml = useMemo(() => {
    if (!isMarkdown || !content) return "";
    return marked.parse(content, { async: false }) as string;
  }, [isMarkdown, content]);

  const handleMarkdownClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      e.preventDefault();
      const href = anchor.getAttribute("href");
      if (!href) return;

      if (/^https?:\/\//.test(href)) {
        window.open(href);
        return;
      }

      if (href.startsWith("#")) {
        const target = (e.currentTarget as HTMLElement).querySelector(href);
        target?.scrollIntoView({ behavior: "smooth" });
        return;
      }

      if (onNavigate && filePath) {
        const dir = filePath.substring(0, filePath.lastIndexOf("/"));
        const resolved = dir + "/" + href;
        onNavigate(resolved);
      }
    },
    [filePath, onNavigate]
  );

  const enterEdit = useCallback(() => {
    if (!isEditable) return;
    setEditContent(content);
    setEditing(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [isEditable, content]);

  const saveAndExit = useCallback(async () => {
    if (!filePath) return;
    if (editContent !== originalContentRef.current) {
      setSaving(true);
      try {
        await window.termcanvas.fs.writeFile(filePath, editContent);
        setContent(editContent);
        originalContentRef.current = editContent;
      } catch {
        // Write failed — silently revert to view mode
      } finally {
        setSaving(false);
      }
    }
    setEditing(false);
  }, [filePath, editContent]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveAndExit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    },
    [saveAndExit, cancelEdit],
  );

  if (!filePath) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[var(--text-muted)] text-[11px]">{t.no_file_selected}</span>
      </div>
    );
  }

  const fileName = filePath.split("/").pop() || "";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2.5 border-b border-[var(--border)] flex items-center gap-2 shrink-0">
        <span className="text-[11px] font-medium text-[var(--text-primary)] truncate flex-1">{fileName}</span>
        {editing && (
          <span className="text-[10px] text-[var(--text-faint)]">
            {saving ? "saving..." : "Esc cancel · ⌘S save"}
          </span>
        )}
        {!editing && isMarkdown && (
          <button
            className="flex items-center justify-center h-5 px-1.5 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
            onClick={() => setShowSource((v) => !v)}
            title={showSource ? t.preview_rendered : t.preview_source}
          >
            {showSource ? (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2C4.5 2 1.6 4.5.5 8c1.1 3.5 4 6 7.5 6s6.4-2.5 7.5-6c-1.1-3.5-4-6-7.5-6zm0 10a4 4 0 110-8 4 4 0 010 8zm0-6.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.854 4.854a.5.5 0 10-.708-.708l-3.5 3.5a.5.5 0 000 .708l3.5 3.5a.5.5 0 00.708-.708L2.707 8l3.147-3.146zm4.292 0a.5.5 0 01.708-.708l3.5 3.5a.5.5 0 010 .708l-3.5 3.5a.5.5 0 01-.708-.708L13.293 8l-3.147-3.146z"/>
              </svg>
            )}
          </button>
        )}
        {!editing && isEditable && (
          <button
            className="flex items-center justify-center h-5 px-1.5 rounded text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
            onClick={enterEdit}
            title="Edit"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12.146.854a.5.5 0 01.708 0l2.292 2.292a.5.5 0 010 .708l-9.5 9.5a.5.5 0 01-.168.11l-4 1.5a.5.5 0 01-.638-.638l1.5-4a.5.5 0 01.11-.168l9.5-9.5zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.293l6.5-6.5z"/>
            </svg>
          </button>
        )}
        <button
          className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
          onClick={onClose}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-[var(--text-muted)] text-[11px]">{t.loading}</span>
          </div>
        ) : editing ? (
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onBlur={saveAndExit}
            onKeyDown={handleKeyDown}
            className="w-full h-full p-4 text-[var(--text-secondary)] bg-transparent resize-none outline-none leading-relaxed"
            style={{ fontFamily: '"Geist Mono", monospace', fontSize: 11 }}
            spellCheck={false}
          />
        ) : isMarkdown && !showSource ? (
          <div
            className="px-4 py-3 prose prose-sm prose-invert max-w-none text-[12px] leading-relaxed text-[var(--text-primary)] cursor-text [&_h1]:text-[17px] [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:text-[13px] [&_h3]:font-semibold [&_h1]:text-[var(--text-primary)] [&_h2]:text-[var(--text-primary)] [&_h3]:text-[var(--text-secondary)] [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:pb-1.5 [&_h1]:border-b [&_h1]:border-[var(--border)] [&_h2]:mt-4 [&_h2]:mb-1.5 [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:my-2 [&_a]:text-[var(--accent)] [&_a]:cursor-pointer [&_code]:text-[var(--amber)] [&_code]:bg-[var(--bg)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_pre]:bg-[var(--bg)] [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:text-[11px] [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:my-0.5 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border-hover)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-muted)] [&_hr]:border-[var(--border)] [&_table]:text-[11px] [&_th]:p-1.5 [&_td]:p-1.5 [&_th]:border [&_td]:border [&_th]:border-[var(--border)] [&_td]:border-[var(--border)] [&_img]:max-w-full [&_img]:rounded"
            onClick={(e) => {
              // If clicking a link, handle navigation; otherwise enter edit
              const anchor = (e.target as HTMLElement).closest("a");
              if (anchor) {
                handleMarkdownClick(e);
              } else {
                enterEdit();
              }
            }}
            dangerouslySetInnerHTML={{ __html: markdownHtml }}
          />
        ) : (
          <pre
            className="px-4 py-3 text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap break-words cursor-text"
            style={{ fontFamily: '"Geist Mono", monospace', fontSize: 11 }}
            onClick={isEditable ? enterEdit : undefined}
          >
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
