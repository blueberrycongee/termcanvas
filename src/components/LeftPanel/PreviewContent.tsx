import { useState, useEffect } from "react";
import { useT } from "../../i18n/useT";

interface Props {
  filePath: string | null;
  onClose: () => void;
}

export function PreviewContent({ filePath, onClose }: Props) {
  const t = useT();
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!filePath || !window.termcanvas) {
      setContent("");
      return;
    }

    setLoading(true);
    window.termcanvas.fs.readFile(filePath).then((result) => {
      if ("content" in result) {
        setContent(result.content);
      } else {
        setContent("");
      }
      setLoading(false);
    }).catch(() => {
      setContent("");
      setLoading(false);
    });
  }, [filePath]);

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
        <button
          className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
          onClick={onClose}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto min-h-0" style={{ fontFamily: '"Geist Mono", monospace', fontSize: 11 }}>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-[var(--text-muted)] text-[11px]">{t.loading}</span>
          </div>
        ) : (
          <pre className="px-4 py-3 text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap break-words">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
