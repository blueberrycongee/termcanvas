import { useCallback, useEffect, useRef } from "react";
import { useNotificationStore } from "../stores/notificationStore";

const typeConfig = {
  error: { color: "var(--red)", label: "Error" },
  warn: { color: "var(--amber)", label: "Warning" },
  info: { color: "var(--text-muted)", label: "Info" },
};

const DISMISS_MS = 5000;

function ToastItem({
  n,
  dismiss,
}: {
  n: { id: string; type: "error" | "warn" | "info"; message: string };
  dismiss: (id: string) => void;
}) {
  const config = typeConfig[n.type];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(DISMISS_MS);
  const startRef = useRef(Date.now());

  const startTimer = useCallback(() => {
    startRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      dismiss(n.id);
    }, remainingRef.current);
  }, [dismiss, n.id]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (Date.now() - startRef.current),
      );
    }
  }, []);

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [startTimer]);

  return (
    <div
      key={n.id}
      className="tc-enter-slide-right rounded-md border border-[var(--border)] px-4 py-3 bg-[var(--surface)] flex items-start gap-3"
      style={{ boxShadow: "var(--shadow-elev-2)" }}
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
    >
      <div
        className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
        style={{ backgroundColor: config.color }}
      />
      <div className="flex-1 min-w-0">
        <div
          className="tc-eyebrow tc-mono mb-0.5"
          style={{ color: config.color, opacity: 0.7 }}
        >
          {config.label}
        </div>
        <span className="tc-body-sm break-words">{n.message}</span>
      </div>
      <button
        className="shrink-0 text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors p-0.5"
        style={{
          transitionDuration: "var(--duration-quick)",
          transitionTimingFunction: "var(--ease-out-soft)",
        }}
        onClick={() => dismiss(n.id)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M3 3L9 9M9 3L3 9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

export function NotificationToast() {
  const { notifications, dismiss } = useNotificationStore();

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {notifications.map((n) => (
        <ToastItem key={n.id} n={n} dismiss={dismiss} />
      ))}
    </div>
  );
}
