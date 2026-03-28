# Smart Rendering Design

## Overview

Add an intelligent rendering layer to TermCanvas that intercepts terminal output from AI CLI tools (Claude Code, Codex CLI), parses structured content (code blocks, markdown, diffs, thinking blocks, tool calls), and renders them as HTML overlay components on top of the xterm canvas — replacing the character-grid rendering with high-quality native UI elements.

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Target CLIs | Claude Code + Codex CLI | Primary daily-driver tools |
| Rendering location | Overlay on xterm canvas | Natural UX, no extra panels, xterm untouched |
| Content types (v1) | Code blocks, Markdown, Diff, Thinking, Tool calls | Full coverage of AI CLI output patterns |
| Parsing strategy | Strip ANSI → parse markdown | `marked` already a dependency, ANSI strip regex exists |
| Activation trigger | Process detection (existing) | `process-detector.ts` already identifies claude/codex, zero cost |
| Architecture | Overlay layer (Option A) | Lowest risk, xterm unchanged, full HTML rendering power |

## Architecture

```
PTY byte stream
    │
    ▼
handleRuntimeOutput()
    │
    ├── [all terminals] appendPreview(data) + triggerDetection()
    │
    ├── [non-AI CLI] xterm.write(data)  ← existing path unchanged
    │
    └── [claude/codex] SmartRenderPipeline
                │
                ├── 1. ANSI Stripper — remove escape sequences, keep raw text
                ├── 2. Incremental Parser — stateful state machine
                ├── 3. Segment Buffer — buffer incomplete blocks
                └── 4. Render Dispatcher
                        │
                        ├── raw segment → xterm.write() only
                        └── structured segment → Overlay Manager
                                │
                                ├── CodeBlock overlay
                                ├── Markdown overlay
                                ├── Diff overlay
                                ├── Thinking overlay
                                └── ToolCall overlay
```

**Key design rule:** xterm always receives ALL data. Overlays visually cover the corresponding xterm regions but do not suppress writes. This preserves scrollback, search, serialization, and all existing xterm functionality. Smart rendering is an additive visual enhancement, not a replacement.

## Incremental Parser

### State Machine

```
NORMAL ──────┬── encounters ``` ──────→ CODE_BLOCK ──── encounters ``` ──→ NORMAL
             │
             ├── encounters # / - / * / > ──→ MARKDOWN_LINE ── newline ──→ NORMAL
             │
             ├── encounters +/- diff pattern ──→ DIFF_BLOCK ── blank line ──→ NORMAL
             │
             ├── encounters thinking marker ──→ THINKING ── end marker ──→ NORMAL
             │
             └── encounters tool call pattern ──→ TOOL_CALL ── end ──→ NORMAL
```

### Streaming Chunk Handling

- Character-by-character consumption with state persistence across chunks
- Lookahead buffer for ambiguous sequences (e.g., single ` vs ```)
- Block buffering: collect content until closing marker, emit `pending` segment during collection
- Timeout fallback: if a block stays open for 10s, force flush as raw to xterm

### Dual-Track Processing

- Maintain a stripped buffer (ANSI removed) for pattern matching
- Maintain a raw buffer for xterm.write and line count calculation
- Both advance in lockstep per chunk

### Segment Output

```typescript
type SegmentType = 'raw' | 'code_block' | 'markdown' | 'diff' | 'thinking' | 'tool_call';

interface Segment {
  type: SegmentType;
  content: string;          // ANSI-stripped text
  rawContent: string;       // original ANSI bytes (for xterm.write)
  startLine: number;        // start line in xterm buffer
  lineCount: number;        // number of lines occupied
  status: 'pending' | 'complete';
  meta?: {
    language?: string;      // code block language
    toolName?: string;      // tool call name
  };
}
```

## Overlay Manager

### Positioning

Overlay container is absolutely positioned over the xterm canvas with identical dimensions, `pointer-events: none`.

```
TerminalTile
├── xterm container (position: relative)
│   └── xterm canvas
└── overlay container (position: absolute, inset: 0, overflow: hidden)
    └── overlay items (position: absolute, top/left/width/height computed)
```

Position calculation per overlay item:

```typescript
const dims = xterm._core._renderService.dimensions;
const cellWidth = dims.css.cell.width;
const cellHeight = dims.css.cell.height;

const viewportRow = segment.startLine - xterm.buffer.active.viewportY;
const top = viewportRow * cellHeight;
const height = segment.lineCount * cellHeight;
```

### Scroll Sync

Listen to xterm `onScroll` event, recalculate `top` for all visible overlays. Overlays outside viewport ± 50 lines are recycled (`display: none`).

### Resize

On xterm resize, `OverlayManager.relayout()` recalculates all overlay positions and widths.

### Interaction

- Default: `pointer-events: none` (pass-through to xterm)
- On hover: switch to `pointer-events: auto`, show interactive controls
- Interactive elements: copy button (code blocks), collapse/expand (thinking, tool calls), dismiss

## Overlay Components

### 1. CodeBlock

- Syntax highlighting via `shiki` or `highlight.js`
- Language badge, optional line numbers, copy button
- Pending state: pulsing bottom bar with live content appending

### 2. Markdown

- Rendered via existing `marked` dependency
- Covers: headings, bold, lists, links, tables, inline code
- Line-level — each line can be rendered individually, no block buffering needed

### 3. Diff

- Reuses rendering logic from existing `DiffContent` component
- File name header, change bar, colored +/- lines
- Auto-collapse for diffs > 50 lines

### 4. Thinking

- Identification: Claude's `<thinking>` tags / Codex reasoning prefix
- Default expanded during streaming, auto-collapse when complete
- Collapsed state shows first line + "...N lines"
- Dimmed, italic styling

### 5. ToolCall

- Identification: Claude/Codex tool call output patterns (tool name + result)
- Default collapsed, showing tool name + brief summary
- Expanded view shows full output with syntax highlighting for code results

### Shared Styling

- Theme follows terminal color variables (`var(--text-primary)`, `var(--surface)`, etc.)
- Rounded borders `rounded-md`, semi-transparent background `bg-[var(--surface)]/90`
- Width = xterm viewport width - horizontal padding

## Integration

### Entry Point

Single change in `handleRuntimeOutput()`:

```typescript
function handleRuntimeOutput(runtime: ManagedTerminalRuntime, data: string) {
  appendPreview(runtime, data);
  runtime.xterm?.write(data);

  if (isSmartRenderEnabled(runtime)) {
    runtime.smartPipeline.feed(data);
  }

  triggerDetection(runtime);
  // ... rest unchanged
}
```

`isSmartRenderEnabled` checks `runtime.meta.terminal.type === "claude" || "codex"`.

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Terminal clear (Ctrl+L) | Listen to xterm buffer clear event, clear all overlays + reset parser state |
| CLI process exits | Stop parsing, preserve existing overlays for reading |
| Terminal resize | OverlayManager.relayout() recalculates all positions |
| User scrolls to history | Overlays follow viewport scroll, recycle offscreen ones |
| Parse misidentification | User can dismiss individual overlays, region marked as "skip" |
| Performance | Only render overlays within viewport ± 50 lines, cap at scrollback limit (5000 lines) |

### User Controls

- Global toggle: `smartRender: boolean` in preferences (default: `true`)
- Per-overlay dismiss button
