interface BubbleButtonProps {
  activeTaskCount: number;
  onExpand: () => void;
  style?: React.CSSProperties;
}

export function BubbleButton({ activeTaskCount, onExpand, style }: BubbleButtonProps) {
  const hasActiveTasks = activeTaskCount > 0;

  return (
    <button
      className="fixed z-[95] flex items-center justify-center w-11 h-11 rounded-full border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] transition-colors duration-150 shadow-lg"
      style={{ bottom: 128, right: 16, ...style }}
      onClick={onExpand}
      aria-label="Open agent panel"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 16V6a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H7l-3 2z" />
        <path d="M8 8h4M8 11h2" />
      </svg>
      {hasActiveTasks && (
        <span
          className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 rounded-full bg-[var(--accent)] text-white text-[10px] font-medium px-1 status-pulse"
        >
          {activeTaskCount}
        </span>
      )}
    </button>
  );
}
