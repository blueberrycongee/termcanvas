# Hydra Review Result

## Verdict: APPROVE

## Files Reviewed
- `src/components/ComposerBar.tsx` — the diff under review
- `src/hooks/shortcutTarget.ts` — `hasPrimaryModifier` implementation

## Issues Found
None.

## Analysis

### 1. Type Compatibility
`hasPrimaryModifier` accepts `Pick<KeyboardEvent, "metaKey" | "ctrlKey">`. The event parameter in `getPassthroughSequence` is `React.KeyboardEvent<HTMLTextAreaElement>`, which has both `metaKey` and `ctrlKey` properties. Structurally compatible — no type errors.

### 2. Linux Behavioral Change
Before this change, `event.metaKey` was always `false` on both Linux and Windows, so arrow key forwarding only triggered when `draft.trim().length === 0`. After this change, `hasPrimaryModifier` returns `event.ctrlKey` on non-darwin platforms, so Ctrl+Arrow now forwards to the terminal on Linux too. This is correct — the code comment says "Cmd+Arrow → always forward to terminal (history / cursor control)", and Ctrl is the platform equivalent of Cmd on Linux/Windows. This was a latent bug on both platforms, not just Windows.

### 3. Import Path
`from "../hooks/shortcutTarget"` uses no `.ts` extension, consistent with every other import in the file (e.g., `from "../stores/projectStore"`, `from "../stores/composerStore"`).

### 4. Scope
Minimal and focused: one import added, one condition changed. No unnecessary modifications.

## Tests
Review-only task — no code changes made, no tests to run.

## Unresolved Problems
None.
