interface Props {
  onClick: (e: React.MouseEvent) => void;
  stopPropagation?: boolean;
}

export function DismissButton({ onClick, stopPropagation }: Props) {
  return (
    <button
      className="text-[var(--text-faint)] hover:text-[var(--text-primary)] p-0.5 rounded pointer-events-auto shrink-0"
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onClick(e);
      }}
    >
      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
        <path
          d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
