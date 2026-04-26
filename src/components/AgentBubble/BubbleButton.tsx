interface BubbleButtonProps {
  activeTaskCount: number;
  onExpand: () => void;
  style?: React.CSSProperties;
}

export function BubbleButton({ activeTaskCount, onExpand, style }: BubbleButtonProps) {
  const hasActiveTasks = activeTaskCount > 0;

  return (
    <button
      className="fixed z-[95] flex items-center justify-center w-11 h-11 rounded-full"
      style={{
        bottom: 128,
        right: 16,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
        boxShadow: "0 6px 18px color-mix(in srgb, var(--shadow-color) 32%, transparent)",
        transition:
          "background-color var(--duration-quick) var(--ease-out-soft), border-color var(--duration-quick) var(--ease-out-soft), color var(--duration-quick) var(--ease-out-soft)",
        ...style,
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = "var(--surface-hover)";
        el.style.borderColor = "var(--border-hover)";
        el.style.color = "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = "var(--surface)";
        el.style.borderColor = "var(--border)";
        el.style.color = "var(--text-secondary)";
      }}
      onClick={onExpand}
      aria-label="Open agent panel"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 16V6a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H7l-3 2z" />
        <path d="M8 8h4M8 11h2" />
      </svg>
      {hasActiveTasks && (
        <span
          className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 rounded-full status-pulse"
          style={{
            background: "var(--accent)",
            color: "white",
            fontSize: 10,
            fontWeight: "var(--weight-medium)",
            padding: "0 4px",
          }}
        >
          {activeTaskCount}
        </span>
      )}
    </button>
  );
}
