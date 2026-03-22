import { useState, useEffect, useRef } from "react";
import { useT } from "../../i18n/useT";
import type { InsightsGenerateResult, InsightsProgressEvent } from "../../types";

type CliTool = "claude" | "codex";

export function InsightsButton({ compact = false }: { compact?: boolean } = {}) {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<InsightsProgressEvent | null>(null);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [reportPath, setReportPath] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const currentJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    window.termcanvas.insights.getLastReport().then((p) => {
      if (p) setReportPath(p);
    });
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const handleSelect = async (cliTool: CliTool) => {
    setShowPicker(false);
    setRunning(true);
    setError(null);
    setReportPath(null);
    setProgress(null);
    const jobId =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    currentJobIdRef.current = jobId;

    const ins = window.termcanvas.insights;
    cleanupRef.current?.();
    cleanupRef.current = ins.onProgress((p) => {
      if (p.jobId === currentJobIdRef.current) {
        setProgress(p);
      }
    });

    try {
      const result: InsightsGenerateResult = await ins.generate(cliTool, jobId);
      if (result.ok) {
        setReportPath(result.reportPath);
        ins.openReport(result.reportPath);
      } else {
        setError({ message: result.error.message, detail: result.error.detail });
      }
    } catch (err: any) {
      setError({ message: err?.message ?? String(err) });
    } finally {
      setRunning(false);
      currentJobIdRef.current = null;
      cleanupRef.current?.();
      cleanupRef.current = null;
    }
  };

  const openReport = () => {
    if (reportPath) window.termcanvas.insights.openReport(reportPath);
  };

  if (compact) {
    return (
      <div className="relative inline-flex">
        <button
          disabled={running}
          onClick={() => setShowPicker((v) => !v)}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50 cursor-pointer"
          title={t.insights_generate}
        >
          {running ? (
            <div className="w-3 h-3 border-[1.5px] border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              className={reportPath && !error ? "text-green-400" : error ? "text-red-400" : ""}
            >
              <path
                d="M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14M4 4l1.8 1.8M10.2 10.2L12 12M4 12l1.8-1.8M10.2 5.8L12 4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
        {showPicker && (
          <div className="absolute top-full left-0 mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden z-50 min-w-[140px]">
            {reportPath && !running && (
              <button
                className="w-full px-3 py-1.5 text-[11px] text-left text-green-400 hover:bg-[var(--border)]/20 transition-colors duration-100 cursor-pointer border-b border-[var(--border)]"
                onClick={() => { setShowPicker(false); openReport(); }}
              >
                {t.insights_open}
              </button>
            )}
            {(["claude", "codex"] as const).map((tool) => (
              <button
                key={tool}
                className="w-full px-3 py-1.5 text-[11px] text-left text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/20 transition-colors duration-100 cursor-pointer"
                onClick={() => handleSelect(tool)}
              >
                {t.insights_select_cli} {tool.charAt(0).toUpperCase() + tool.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5">
      {/* Error banner */}
      {error && (
        <div className="mb-2 p-2 rounded-md bg-red-500/10 border border-red-500/20">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-red-400">{t.insights_error}</div>
              <div className="text-[10px] text-red-400/80 mt-0.5">{error.message}</div>
              {error.detail && (
                <pre className="text-[9px] text-red-400/60 mt-1 whitespace-pre-wrap break-all">{error.detail}</pre>
              )}
            </div>
            <button
              className="shrink-0 text-[10px] text-red-400/60 hover:text-red-400 cursor-pointer"
              onClick={() => setError(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Success banner */}
      {reportPath && !running && (
        <div className="mb-2 p-2 rounded-md bg-green-500/10 border border-green-500/20">
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-green-400 font-medium">{t.insights_done}</div>
            <button
              className="shrink-0 text-[10px] text-green-400/60 hover:text-green-400 cursor-pointer"
              onClick={() => setReportPath(null)}
            >
              ✕
            </button>
          </div>
          <button
            className="text-[10px] text-green-400/80 hover:text-green-400 underline mt-0.5 cursor-pointer"
            onClick={openReport}
          >
            {t.insights_open}
          </button>
        </div>
      )}

      {/* Running state */}
      {running && (
        <div className="mb-2 flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="text-[11px] text-[var(--text-muted)] truncate">
            {progress?.message ?? t.insights_generating}
          </span>
        </div>
      )}

      {/* Progress bar */}
      {running && progress && progress.total > 0 && (
        <div className="mb-2 h-1 rounded-full bg-[var(--border)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
            style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
          />
        </div>
      )}

      {/* Main button + dropdown */}
      <div className="relative">
        {showPicker && (
          <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden z-10">
            {(["claude", "codex"] as const).map((tool) => (
              <button
                key={tool}
                className="w-full px-3 py-1.5 text-[11px] text-left text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/20 transition-colors duration-100 cursor-pointer"
                onClick={() => handleSelect(tool)}
              >
                {t.insights_select_cli} {tool.charAt(0).toUpperCase() + tool.slice(1)}
              </button>
            ))}
          </div>
        )}
        <button
          disabled={running}
          className="w-full py-1.5 px-3 rounded-md text-[11px] font-medium border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setShowPicker((v) => !v)}
        >
          {t.insights_generate}
        </button>
      </div>
    </div>
  );
}
