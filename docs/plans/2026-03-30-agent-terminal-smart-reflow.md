# Agent Terminal Smart Reflow

**Goal:** Focused `claude` / `codex` terminals visually reflow during sidebar drag with zero PTY resize, zero flicker, zero focus churn.

**Core idea:** Borrow [pretext](https://github.com/chenglou/pretext)'s two-phase architecture — separate expensive preparation from cheap layout. For monospace terminals this degenerates to: prepare = snapshot buffer once, layout = `cols = floor(width / cellWidth)` + walk array inserting breaks. The hot path during drag is pure integer arithmetic with no DOM measurement, no xterm `fit()`, no PTY `resize()`.

**Scope:** Agent terminals only (`claude`, `codex`). All other terminal types stay on the current live resize path.

---

## Architecture

```
Drag start (prepare, once)
  ├─ Snapshot xterm.buffer.active → LogicalLine[]
  ├─ Read cellWidth, cellHeight from xterm render dimensions
  ├─ Mount overlay <canvas> over xterm container
  └─ Hide xterm canvas (visibility: hidden)

Drag move (layout + render, per frame)
  ├─ cols = floor(contentWidth / cellWidth)
  ├─ if cols === prevCols → skip frame
  ├─ Reflow LogicalLine[] at cols → rows[] (pure arithmetic)
  └─ Paint visible rows to overlay canvas (fillText)

Drag end (commit, once)
  ├─ Remove overlay canvas
  ├─ Show xterm canvas
  ├─ fitAddon.fit()
  └─ PTY resize(ptyId, cols, rows)
```

### Why This Works

In a monospace grid every cell is exactly `cellWidth` pixels. There is no glyph measurement, no canvas `measureText()`, no DOM layout query. Reflowing N characters at a new column count is O(N) array walking — the same complexity class as pretext's `layout()`, but without the Unicode segmentation and proportional-width arithmetic.

During a typical sidebar drag (~0.5s), the hot path runs ~30 times. Each run: one integer division + one array walk + one canvas paint of visible rows. No work touches the PTY, xterm internals, or React reconciliation.

---

## Task 1 — Buffer Snapshot and Reflow Engine

Pure logic module. No DOM, no xterm runtime dependency beyond the buffer read.

**Create:** `src/terminal/agentReflow.ts`
**Test:** `tests/agent-reflow.test.ts`

### Types

```ts
/** One logical line of terminal content (soft-wraps merged). */
interface LogicalLine {
  text: string;
  widths: number[];  // per-char cell width: 1 normal, 2 wide (CJK/emoji)
}

interface BufferSnapshot {
  lines: LogicalLine[];
}

interface ReflowResult {
  rows: string[];     // one entry per display row after reflow
  totalRows: number;
}
```

### `snapshotBuffer(xterm: Terminal): BufferSnapshot`

Walk `xterm.buffer.active` from line 0 to `buffer.length`. For each `IBufferLine`:

- If `line.isWrapped === true`, this is a continuation of the previous logical line — append its content.
- Otherwise start a new `LogicalLine`.
- Read characters via `line.getCell(x).getChars()` and widths via `line.getCell(x).getWidth()`. Skip cells with `getWidth() === 0` (second cell of a wide char).

The result is an array of logical lines with accurate per-character widths.

### `reflowSnapshot(snapshot: BufferSnapshot, cols: number): ReflowResult`

For each `LogicalLine`, walk its `widths` array accumulating column usage. When adding a character would exceed `cols`:

- If the character is wide (width=2) and only 1 column remains, emit the current row with a trailing space (terminal wrapping semantics for wide chars at boundary).
- Otherwise emit the current row and start a new one.

Empty logical lines produce one empty row. The output is a flat `string[]` of display rows.

### Tests

```
snapshotBuffer:
  - merges isWrapped continuation lines into one LogicalLine
  - starts new LogicalLine on non-wrapped line
  - records width=2 for wide characters
  - skips width=0 continuation cells

reflowSnapshot:
  - short line (< cols) → 1 row, unchanged
  - long line (> cols) → wraps at cols boundary
  - wide char at col boundary → pushed to next row with trailing space
  - multiple logical lines each reflow independently
  - empty line → one empty row
  - cols=1 → each character on its own row (wide chars get 1 row each)
  - reflow is idempotent: reflowSnapshot(snap, cols) twice = same result
  - perf: 10k logical lines, 80 cols, completes in <10ms
```

### Commit

```
feat: add agent terminal buffer snapshot and reflow engine
```

---

## Task 2 — Overlay Canvas Renderer

A lightweight React component that paints reflowed text rows to a `<canvas>`, matching xterm's monospace font. Only the visible portion is rendered (virtual scroll from bottom).

**Create:** `src/terminal/AgentReflowOverlay.tsx`

### Props

```ts
interface AgentReflowOverlayProps {
  rows: string[];
  cellWidth: number;
  cellHeight: number;
  width: number;         // container pixel width
  height: number;        // container pixel height
  fontFamily: string;
  fontSize: number;
  fg: string;            // foreground color from xterm theme
  bg: string;            // background color from xterm theme
}
```

### Rendering

```ts
// Determine visible range (scroll to bottom, matching terminal behavior)
const visibleRows = Math.floor(height / cellHeight);
const startRow = Math.max(0, rows.length - visibleRows);

// Clear and paint
ctx.fillStyle = bg;
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = fg;
ctx.font = `${fontSize}px ${fontFamily}`;
ctx.textBaseline = "top";

for (let i = startRow; i < rows.length && i < startRow + visibleRows; i++) {
  const y = (i - startRow) * cellHeight;
  ctx.fillText(rows[i], 0, y);
}
```

### Design decisions

- **Canvas, not DOM `<pre>`:** Avoids browser layout reflow during drag. Pixel-paints like xterm does.
- **No ANSI color in v1:** Agent output is mostly plain text. Colors return instantly on drag-end when xterm resumes. Can add ANSI color parsing later if needed.
- **Positioned absolutely** over the xterm container `<div>`, same z-index layer. `pointer-events: none` so drag events pass through.
- **DPR-aware:** Set `canvas.width = width * devicePixelRatio`, scale context, so text is sharp on retina.

### Commit

```
feat: add agent reflow overlay canvas renderer
```

---

## Task 3 — Drag Integration in TerminalTile

Wire the reflow engine and overlay into the existing drag flow. The key change: during sidebar drag, focused agent terminals show the overlay instead of resizing xterm.

**Modify:** `src/terminal/TerminalTile.tsx`
**Modify:** `src/components/LeftPanel.tsx`

### Drag signal

Add a module-level signal (Zustand atom or plain ref + subscription) so TerminalTile knows when a sidebar drag is active:

```ts
// src/stores/sidebarDragStore.ts
import { create } from "zustand";

interface SidebarDragState {
  active: boolean;
  setActive: (v: boolean) => void;
}

export const useSidebarDragStore = create<SidebarDragState>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}));
```

### LeftPanel changes

```ts
// In handleResizeStart:
const handleMove = (ev: PointerEvent) => {
  setWidth(Math.max(200, Math.min(600, origW + (ev.clientX - startX))));
  // Remove: panToTerminal per-move call
  // The overlay handles visual reflow; no viewport/fit work needed during drag.
};

// Before attaching listeners:
useSidebarDragStore.getState().setActive(true);

// In cleanup:
useSidebarDragStore.getState().setActive(false);
// Commit: one panToTerminal call with final width
const tid = findFocusedTerminalId(projects);
if (tid) panToTerminal(tid, { immediate: true });
```

This removes the RAF + `panToTerminal` per-move loop entirely. During drag, only `setWidth()` fires, which updates CSS layout (tile width changes via tileDimensionsStore subscription). The overlay reads the new width and reflows.

### TerminalTile changes

Guard the existing fit effect:

```ts
const dragActive = useSidebarDragStore((s) => s.active);
const isAgent = terminal.type === "claude" || terminal.type === "codex";

useEffect(() => {
  if (terminal.minimized || lodMode !== "live") return;
  if (isAgent && dragActive) return;  // suppress fit during drag
  const frame = requestAnimationFrame(() => fitTerminalRuntime(terminal.id));
  return () => cancelAnimationFrame(frame);
}, [height, lodMode, terminal.id, terminal.minimized, width, dragActive, isAgent]);
```

Add overlay lifecycle:

```ts
const [reflowState, setReflowState] = useState<{
  snapshot: BufferSnapshot;
  cellWidth: number;
  cellHeight: number;
} | null>(null);

// On drag start: snapshot
useEffect(() => {
  if (!isAgent || !dragActive || lodMode !== "live") {
    setReflowState(null);
    return;
  }
  const runtime = getTerminalRuntime(terminal.id);
  if (!runtime?.xterm) return;

  const snapshot = snapshotBuffer(runtime.xterm);
  const dims = (runtime.xterm as any)._core?._renderService?.dimensions?.css?.cell;
  if (!dims) return;

  setReflowState({ snapshot, cellWidth: dims.width, cellHeight: dims.height });
}, [isAgent, dragActive, lodMode, terminal.id]);

// Compute reflow on width change
const reflowResult = useMemo(() => {
  if (!reflowState) return null;
  const cols = Math.max(1, Math.floor(width / reflowState.cellWidth));
  return reflowSnapshot(reflowState.snapshot, cols);
}, [reflowState, width]);
```

In JSX, when `reflowResult` is non-null, render `<AgentReflowOverlay>` over the xterm container and set xterm container to `visibility: hidden`.

### Commit

```
feat: integrate agent reflow overlay with sidebar drag
```

---

## Task 4 — Focus Stability

Independent fix. Can land before or after the overlay work.

**Modify:** `src/utils/panToTerminal.ts`

### Problem

`panToTerminal` unconditionally calls `setFocusedTerminal(terminalId)` on every invocation, including the drag-end commit. While the overlay eliminates per-move calls, the redundant focus dispatch on an already-focused terminal still causes unnecessary subscriber notifications.

### Fix

```ts
// In panToTerminal, before setFocusedTerminal:
const current = useProjectStore.getState().focusedTerminalId;
if (current !== terminalId) {
  useProjectStore.getState().setFocusedTerminal(terminalId);
}
```

### Commit

```
fix: skip redundant focus dispatch in panToTerminal
```

---

## Fallback

If the overlay approach causes issues, Task 3's fit-suppression guard alone (skip `fitTerminalRuntime` during drag, one commit on drag-end) is already a major improvement. The overlay can be removed without affecting the core resize-storm fix.

## Not in Scope

- ANSI color rendering in the overlay. Colors return on drag-end.
- New npm dependencies. Monospace reflow needs no library.
- Changes to non-agent terminal resize paths.
- Phase 2 transcript model. If v1 overlay is sufficient, there is no phase 2.
