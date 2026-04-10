import { useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../stores/projectStore";

interface TagManagerProps {
  projectId: string;
  worktreeId: string;
  terminalId: string;
  clientX: number;
  clientY: number;
  onClose: () => void;
}

const AUTO_PREFIXES = ["project:", "worktree:", "type:", "status:"] as const;

function isAutoTag(tag: string): boolean {
  return AUTO_PREFIXES.some((prefix) => tag.startsWith(prefix));
}

export function TagManager({
  projectId,
  worktreeId,
  terminalId,
  clientX,
  clientY,
  onClose,
}: TagManagerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");

  const tags = useProjectStore((state) => {
    for (const project of state.projects) {
      if (project.id !== projectId) continue;
      for (const worktree of project.worktrees) {
        if (worktree.id !== worktreeId) continue;
        const terminal = worktree.terminals.find((t) => t.id === terminalId);
        return terminal?.tags ?? [];
      }
    }
    return [] as string[];
  });

  const addTag = useProjectStore((state) => state.addTerminalTag);
  const removeTag = useProjectStore((state) => state.removeTerminalTag);

  const { autoTags, customTags } = useMemo(() => {
    const auto: string[] = [];
    const custom: string[] = [];
    for (const tag of tags) {
      if (isAutoTag(tag)) {
        auto.push(tag);
      } else if (tag.startsWith("custom:")) {
        custom.push(tag);
      }
    }
    return { autoTags: auto, customTags: custom };
  }, [tags]);

  useEffect(() => {
    function handleAway(event: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) onClose();
    }
    function handleEsc(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleAway);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleAway);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  const submitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const tag = trimmed.startsWith("custom:") ? trimmed : `custom:${trimmed}`;
    addTag(projectId, worktreeId, terminalId, tag);
    setDraft("");
  };

  return (
    <div
      ref={ref}
      className="fixed z-[100] w-[260px] rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-xl p-3"
      style={{ left: clientX, top: clientY }}
    >
      <div className="text-xs font-semibold text-[var(--text-primary)] mb-2">
        Tags
      </div>

      {autoTags.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
            Auto
          </div>
          <div className="flex flex-wrap gap-1">
            {autoTags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded text-[10px] bg-[var(--border)] text-[var(--text-muted)]"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mb-2">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
          Custom
        </div>
        {customTags.length === 0 ? (
          <div className="text-[11px] text-[var(--text-muted)] italic">
            No custom tags
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {customTags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded text-[10px] bg-[var(--accent)]/10 text-[var(--accent)] flex items-center gap-1"
              >
                {tag.replace(/^custom:/, "")}
                <button
                  type="button"
                  className="hover:text-red-400"
                  onClick={() =>
                    removeTag(projectId, worktreeId, terminalId, tag)
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1">
        <input
          autoFocus
          type="text"
          placeholder="Add tag…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitDraft();
            }
          }}
          className="flex-1 px-2 py-1 text-[11px] rounded bg-[var(--background)] border border-[var(--border)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={submitDraft}
          className="px-2 py-1 text-[11px] rounded bg-[var(--button-bg)] hover:bg-[var(--button-bg-hover)] text-[var(--button-text)]"
        >
          Add
        </button>
      </div>
    </div>
  );
}
