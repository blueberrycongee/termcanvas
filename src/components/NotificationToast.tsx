import { useNotificationStore } from "../stores/notificationStore";

const typeConfig = {
  error: { color: "var(--red)", label: "Error" },
  warn: { color: "var(--amber)", label: "Warning" },
  info: { color: "var(--text-muted)", label: "Info" },
};

export function NotificationToast() {
  const { notifications, dismiss } = useNotificationStore();

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {notifications.map((n) => {
        const config = typeConfig[n.type];
        return (
          <div
            key={n.id}
            className="tc-enter-slide-right rounded-md border border-[var(--border)] px-4 py-3 bg-[var(--surface)] flex items-start gap-3"
            style={{ boxShadow: "var(--shadow-elev-2)" }}
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
              <span className="tc-body-sm break-words">
                {n.message}
              </span>
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
      })}
    </div>
  );
}
