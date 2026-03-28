# Comment Cleanup Design

## Goal

Remove "what" comments (describe code behavior) across the entire project.
Retain "why" comments (explain reasoning, trade-offs, workarounds).
Rewrite "what" comments as "why" when the underlying intent is non-obvious after deletion.

## Scope

87 TypeScript files containing comments across `src/`, `electron/`, `hydra/src/`, `tests/`.

## Review criteria

Each comment is reviewed against its surrounding code:

| Category | Action |
|----------|--------|
| Pure "what" (restates code, e.g. `// Parse JSON`) | Delete |
| Stale comment (does not match current code) | Delete |
| Unit conversion (e.g. `// 30 minutes`) | Keep — quick-read value outweighs redundancy |
| "What" hiding a "why" | Rewrite as "why" |
| "Why" / platform workaround / race condition | Keep |
| JSDoc (`/** ... */`) | Keep |
| Section dividers (`// ── Name ──`) | Keep |
| TODO / FIXME / HACK | Keep (separate cleanup) |

## Execution: Hydra spawn, directory-sharded

Four parallel `hydra spawn` workers, each in its own worktree:

| Worker | Directory | Files |
|--------|-----------|-------|
| 1 | `src/` | 46 |
| 2 | `electron/` | 24 |
| 3 | `hydra/src/` | 10 |
| 4 | `tests/` | 7 |

Why `spawn` over `run`: the task is well-defined with clear criteria — no planner/evaluator loop needed. Each worker is independent with no cross-directory dependencies.

Each worker prompt includes:
- The review criteria above
- Its assigned directory scope
- Instruction to read each file, review each comment against code
- Requirement to run `tsc --noEmit` after changes

## Merge strategy

After all workers complete:
1. Review each worktree's changes
2. Cherry-pick or merge into main branch
3. Run `tsc --noEmit` for global type check
4. Single commit per worker directory
