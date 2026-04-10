import { useCallback, useState } from "react";
import { useClusterStore } from "../stores/clusterStore";
import type { ClusterRule } from "../clustering";

interface RuleOption {
  rule: ClusterRule;
  label: string;
}

const RULE_OPTIONS: RuleOption[] = [
  { rule: "by-project", label: "By Project" },
  { rule: "by-worktree", label: "By Worktree" },
  { rule: "by-type", label: "By Type" },
  { rule: "by-status", label: "By Status" },
  { rule: "by-custom", label: "By Custom Tag" },
];

export function ClusterToolbar() {
  const [open, setOpen] = useState(false);
  const applyCluster = useClusterStore((state) => state.applyCluster);
  const undoCluster = useClusterStore((state) => state.undoCluster);
  const canUndo = useClusterStore((state) => state.positionSnapshot !== null);
  const lastRule = useClusterStore((state) => state.lastRule);

  const handlePick = useCallback(
    (rule: ClusterRule) => {
      applyCluster(rule);
      setOpen(false);
    },
    [applyCluster],
  );

  return (
    <div className="absolute top-4 right-4 z-30 flex items-center gap-2 nowheel">
      <div className="relative">
        <button
          type="button"
          className="px-3 py-1.5 rounded-md bg-[var(--button-bg)] hover:bg-[var(--button-bg-hover)] text-[var(--button-text)] text-sm shadow-md"
          onClick={() => setOpen((value) => !value)}
        >
          Cluster{lastRule ? ` · ${formatRule(lastRule)}` : ""}
        </button>
        {open && (
          <div className="absolute right-0 mt-1 min-w-[180px] rounded-md border border-[var(--border)] bg-[var(--panel-bg)] shadow-lg overflow-hidden">
            {RULE_OPTIONS.map((option) => (
              <button
                key={option.rule}
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--button-bg-hover)] text-[var(--text)]"
                onClick={() => handlePick(option.rule)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={!canUndo}
        onClick={() => undoCluster()}
        className="px-3 py-1.5 rounded-md bg-[var(--button-bg)] hover:bg-[var(--button-bg-hover)] text-[var(--button-text)] text-sm shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Undo
      </button>
    </div>
  );
}

function formatRule(rule: ClusterRule): string {
  switch (rule) {
    case "by-project":
      return "Project";
    case "by-worktree":
      return "Worktree";
    case "by-type":
      return "Type";
    case "by-status":
      return "Status";
    case "by-custom":
      return "Custom";
  }
}
