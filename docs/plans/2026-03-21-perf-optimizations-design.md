# Performance Optimizations Design

Date: 2026-03-21

## Problem

When many terminals are open (>10), the app becomes sluggish. Three root causes identified:

1. **No viewport culling** — all terminals render regardless of canvas visibility
2. **Unbatched IPC output** — each PTY data chunk triggers a separate `webContents.send()`
3. **WebGL context explosion** — each terminal creates its own WebGL context (browser limit ~16)

## Optimization 1: IPC Output Batching

**Files:** `electron/main.ts`, `electron/pty-manager.ts`

### Current behavior
In `main.ts:175-177`, each `onData` callback immediately calls:
```ts
ptyManager.onData(ptyId, (data) => {
  ptyManager.captureOutput(ptyId, data);
  sendToWindow(mainWindow, "terminal:output", ptyId, data);
});
```

### Target behavior
Add an `OutputBatcher` class in `electron/pty-manager.ts` that:
- Accumulates output per ptyId in a `Map<number, string[]>`
- Flushes every 8ms (one frame at ~120fps) via `setTimeout`
- On flush: joins chunks per ptyId and calls `sendToWindow` once per ptyId
- Exposes `push(ptyId, data)` and `flush()` methods
- Constructor takes `flushCallback: (ptyId: number, data: string) => void`

In `main.ts`, replace the direct `sendToWindow` call with `batcher.push(ptyId, data)`.

### Constraints
- `captureOutput()` must still be called immediately (not batched) for output buffer accuracy
- `flushCallback` must handle the case where mainWindow is null
- Batch timer must be cleaned up in `destroyAll()`

## Optimization 2: Viewport Culling

**Files:** `src/canvas/Canvas.tsx`, `src/containers/ProjectContainer.tsx`, new file `src/hooks/useViewportCulling.ts`

### Current behavior
`Canvas.tsx:58-60` renders all projects unconditionally:
```tsx
{projects.map((project) => (
  <ProjectContainer key={project.id} project={project} />
))}
```

### Target behavior
Create a `useViewportCulling` hook that:
1. Reads `viewport` from `canvasStore` and `window.innerWidth/innerHeight`
2. For each project, computes its bounding rect in canvas space using `project.position` and `computeWorktreeSize()`
3. Tests intersection with the visible viewport rect (accounting for `viewport.x`, `viewport.y`, `viewport.scale`)
4. Returns a `Set<string>` of visible project IDs
5. Adds a margin (e.g., 200px in canvas space) so projects don't pop in/out at edges

In `Canvas.tsx`, filter projects through this visibility set before rendering.

### Viewport math
```
visibleRect in canvas space:
  left   = -viewport.x / viewport.scale
  top    = -viewport.y / viewport.scale
  right  = left + window.innerWidth / viewport.scale
  bottom = top + window.innerHeight / viewport.scale

projectRect in canvas space:
  left   = project.position.x
  top    = project.position.y
  right  = left + computedSize.w
  bottom = top + computedSize.h

Visible if rects overlap (with margin).
```

### Constraints
- Must update on viewport changes AND window resize
- Must NOT cull projects that are being dragged (check selectionStore)
- Performance: the culling check itself must be cheap (simple rect overlap, no heavy computation per frame)
- Projects just outside viewport should still render (margin buffer)

## Optimization 3: WebGL Context Pooling

**Files:** new file `src/terminal/webglContextPool.ts`, `src/terminal/TerminalTile.tsx`

### Current behavior
`TerminalTile.tsx:322-328` creates a new WebGL addon per terminal:
```ts
try {
  const webglAddon = new WebglAddon();
  webglAddon.onContextLoss(() => webglAddon.dispose());
  xterm.loadAddon(webglAddon);
} catch { }
```

### Target behavior
Create a `WebGLContextPool` singleton that:
- Tracks active WebGL contexts with LRU ordering: `Map<string, { addon: WebglAddon; lastUsed: number }>`
- `MAX_CONTEXTS = 8` (conservative, well under browser limit)
- `acquire(terminalId, xterm): boolean` — if under limit, create and load WebGL addon, return true. If at limit, evict LRU terminal's WebGL addon (dispose it, that terminal falls back to Canvas2D), then create new one.
- `release(terminalId)` — dispose the addon and remove from pool
- `touch(terminalId)` — update `lastUsed` timestamp (call on terminal focus/interaction)
- Focused terminal should never be evicted

In `TerminalTile.tsx`:
- Replace direct `new WebglAddon()` with `webglContextPool.acquire(terminal.id, xterm)`
- Call `webglContextPool.release(terminal.id)` in cleanup
- Call `webglContextPool.touch(terminal.id)` on focus

### Constraints
- Pool must be a module-level singleton (not React state)
- Eviction must gracefully dispose the WebGL addon — xterm automatically falls back to Canvas2D
- Must handle the case where `acquire` fails (WebGL not available at all)
- `touch()` should be called on terminal focus to keep active terminals in WebGL
