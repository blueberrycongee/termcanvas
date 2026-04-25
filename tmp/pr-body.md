## Summary
- Remove the opacity fade between `HUD_THRESHOLD` and `FADE_END` from `WorktreeLabelLayer` — the element unmounts at opacity 0, so the transition never actually played and the threshold just produced a ghostly half-rendered band.
- Fix the drag-drop snap-back: `finishDrag` now captures the label DOM ref up front, wraps the store commit + `isDragging` flip in `flushSync`, and only resets the imperative transform after React has committed the new `left/top`.

## Why
- The zoom-hide "animation" was always broken — the element was removed before the 120ms transition could run, so users saw a flash rather than a fade.
- The label dropped at the correct position but painted one frame at the old anchor first, because the transform reset ran before the store update propagated.

## Test plan
- [ ] Drag a worktree label across the canvas — on drop, the label should land at the new position without any momentary snap back to the drag start.
- [ ] Zoom past `HUD_THRESHOLD` (0.7) in both directions — labels should appear/disappear cleanly, no fading band.
- [ ] Hover focus still dims non-focused labels (0.35) and lights focused/hovered (1.0).
- [ ] LOD mode (`scale < 0.15`) still collapses into "Project (N)" labels.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
