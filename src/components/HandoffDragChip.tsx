import { useHandoffDragStore } from "../stores/handoffDragStore";

const PREVIEW_MAX = 60;

function previewText(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= PREVIEW_MAX) return collapsed;
  return collapsed.slice(0, PREVIEW_MAX - 1) + "…";
}

export function HandoffDragChip() {
  const active = useHandoffDragStore((s) => s.active);
  const payload = useHandoffDragStore((s) => s.payload);
  const pointer = useHandoffDragStore((s) => s.pointer);

  if (!active || !payload) return null;

  return (
    <div
      aria-hidden="true"
      className="tc-handoff-chip tc-enter-fade"
      style={{
        left: pointer.x,
        top: pointer.y,
      }}
    >
      <span className="tc-handoff-chip-dot" aria-hidden />
      <span className="tc-handoff-chip-source">{payload.sourceTitle}</span>
      <span className="tc-handoff-chip-divider" aria-hidden>
        ›
      </span>
      <span className="tc-handoff-chip-preview">
        {previewText(payload.text)}
      </span>
    </div>
  );
}
