# Canvas Cards & Terminal Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add BrowserCard (embedded browser on canvas), lazygit terminal type, WebGL rendering, and terminal image protocol support to termcanvas.

**Architecture:** Four independent features sharing existing card/terminal infrastructure. BrowserCard introduces a new pattern: a free-floating card not anchored to any worktree, managed by its own Zustand store and rendered directly in Canvas.tsx. lazygit and addons are small additions to existing TerminalTile code.

**Tech Stack:** Electron `<webview>`, Zustand, xterm.js addons (`@xterm/addon-webgl`, `xterm-addon-image`), existing card patterns (drag/resize/portal).

---

### Task 1: Enable WebGL Addon

**Files:**
- Modify: `src/terminal/TerminalTile.tsx:1-4` (imports), `src/terminal/TerminalTile.tsx:113-115` (addon loading)

**Step 1: Add WebGL import**

In `src/terminal/TerminalTile.tsx`, add import after line 4:

```typescript
import { WebglAddon } from "@xterm/addon-webgl";
```

**Step 2: Load WebGL addon with fallback**

In `src/terminal/TerminalTile.tsx`, after line 114 (`xterm.loadAddon(serializeAddon);`), before `xterm.open(containerRef.current);`, add:

```typescript
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(serializeAddon);
    xterm.open(containerRef.current);

    // GPU-accelerated rendering; fall back to Canvas2D when context limit is hit
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLost(() => webglAddon.dispose());
      xterm.loadAddon(webglAddon);
    } catch {
      // WebGL not available or context limit reached — Canvas2D fallback is fine
    }
```

Note: the `xterm.open()` call must come BEFORE loading WebglAddon (it requires a mounted terminal). So the WebGL block goes after `xterm.open(containerRef.current);` (line 115), before the `attachCustomKeyEventHandler` call.

**Step 3: Verify it works**

Run: `npm run dev`
Open the app, create a terminal. Run `ls --color` or any command. Terminal should render identically (WebGL is a transparent backend swap). Check DevTools console for any WebGL errors.

**Step 4: Commit**

```bash
git add src/terminal/TerminalTile.tsx
git commit -m "Enable WebGL addon for GPU-accelerated terminal rendering"
```

---

### Task 2: Add lazygit Terminal Type

**Files:**
- Modify: `src/types/index.ts:1-7` (add type)
- Modify: `src/stores/projectStore.ts:95-102` (add default span)
- Modify: `src/terminal/TerminalTile.tsx:144-178` (add CLI config)
- Modify: `src/i18n/en.ts` (add label)
- Modify: `src/i18n/zh.ts` (add label)
- Modify: `src/containers/WorktreeContainer.tsx:282-329` (add button)

**Step 1: Add `lazygit` to TerminalType**

In `src/types/index.ts`, add `"lazygit"` to the union:

```typescript
export type TerminalType =
  | "shell"
  | "claude"
  | "codex"
  | "kimi"
  | "gemini"
  | "opencode"
  | "lazygit";
```

**Step 2: Add default span**

In `src/stores/projectStore.ts`, add to `DEFAULT_SPAN` (after line 101, before the closing `}`):

```typescript
  lazygit: { cols: 2, rows: 1 },
```

**Step 3: Add CLI config**

In `src/terminal/TerminalTile.tsx`, add to `CLI_CONFIG` (after the `opencode` entry, before the closing `}`):

```typescript
      lazygit: {
        shell: "lazygit",
        resumeArgs: () => [],
        newArgs: [],
      },
```

**Step 4: Add i18n labels**

In `src/i18n/en.ts`, add:

```typescript
  lazygit: "Git (lazygit)",
```

In `src/i18n/zh.ts`, add:

```typescript
  lazygit: "Git (lazygit)",
```

**Step 5: Add Git button to worktree header**

In `src/containers/WorktreeContainer.tsx`, after the existing "new terminal" button (line 327 `</button>`), add a new button before the closing `</div>` of the button group:

```tsx
          <button
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={() => {
              const term = createTerminal("lazygit", "lazygit");
              addTerminal(projectId, worktree.id, term);
            }}
            title={t.lazygit}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <path
                d="M9.5 3.5L8 2L6.5 3.5M8 2v8M4 7l-2 2 2 2M12 7l2 2-2 2M5 14h6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
```

Make sure `createTerminal` and `addTerminal` are accessible in this component (check existing imports — `createTerminal` is imported from `projectStore`, `addTerminal` is from the store's actions).

**Step 6: Verify**

Run: `npm run dev`
Ensure `lazygit` is installed on system (`which lazygit`). Click the git icon button on a worktree header. A lazygit TUI should open in a new terminal tile. Navigate lazygit, make sure keyboard input works. Exit lazygit with `q` and verify the terminal tile handles exit gracefully.

**Step 7: Commit**

```bash
git add src/types/index.ts src/stores/projectStore.ts src/terminal/TerminalTile.tsx src/i18n/en.ts src/i18n/zh.ts src/containers/WorktreeContainer.tsx
git commit -m "Add lazygit as a terminal type with one-click launch"
```

---

### Task 3: Create BrowserCard Store

**Files:**
- Create: `src/stores/browserCardStore.ts`

**Step 1: Write the store**

Create `src/stores/browserCardStore.ts`:

```typescript
import { create } from "zustand";

export interface BrowserCardData {
  id: string;
  url: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BrowserCardStore {
  cards: Record<string, BrowserCardData>;
  addCard: (url: string, position?: { x: number; y: number }) => string;
  removeCard: (id: string) => void;
  updateCard: (id: string, patch: Partial<BrowserCardData>) => void;
}

let counter = 0;

export const useBrowserCardStore = create<BrowserCardStore>((set) => ({
  cards: {},

  addCard: (url, position) => {
    const id = `browser-${Date.now()}-${++counter}`;
    const card: BrowserCardData = {
      id,
      url,
      title: url,
      x: position?.x ?? window.innerWidth / 2 - 400,
      y: position?.y ?? window.innerHeight / 2 - 300,
      w: 800,
      h: 600,
    };
    set((state) => ({ cards: { ...state.cards, [id]: card } }));
    return id;
  },

  removeCard: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.cards;
      return { cards: rest };
    }),

  updateCard: (id, patch) =>
    set((state) => {
      const existing = state.cards[id];
      if (!existing) return state;
      return { cards: { ...state.cards, [id]: { ...existing, ...patch } } };
    }),
}));
```

**Step 2: Commit**

```bash
git add src/stores/browserCardStore.ts
git commit -m "Add Zustand store for BrowserCard state management"
```

---

### Task 4: Create BrowserCard Component

**Files:**
- Create: `src/components/BrowserCard.tsx`

**Step 1: Write the component**

Create `src/components/BrowserCard.tsx`. This follows the same drag/resize pattern as DiffCard and FileCard, but is free-floating (no anchor line, no worktree association):

```tsx
import { useEffect, useRef, useCallback, useState } from "react";
import {
  useBrowserCardStore,
  type BrowserCardData,
} from "../stores/browserCardStore";
import { useCardLayoutStore } from "../stores/cardLayoutStore";
import { useCanvasStore } from "../stores/canvasStore";

interface Props {
  card: BrowserCardData;
}

export function BrowserCard({ card }: Props) {
  const { removeCard, updateCard } = useBrowserCardStore();
  const { register, unregister } = useCardLayoutStore();
  const [urlInput, setUrlInput] = useState(card.url);
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    origW: number;
    origH: number;
  } | null>(null);

  const cardId = `browser:${card.id}`;

  // Register card dimensions for collision avoidance
  useEffect(() => {
    register(cardId, { x: card.x, y: card.y, w: card.w, h: card.h });
    return () => unregister(cardId);
  }, [cardId, card.x, card.y, card.w, card.h, register, unregister]);

  // Sync webview title
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const handler = (e: Electron.PageTitleUpdatedEvent) => {
      updateCard(card.id, { title: e.title });
    };
    wv.addEventListener("page-title-updated", handler as EventListener);
    return () =>
      wv.removeEventListener("page-title-updated", handler as EventListener);
  }, [card.id, updateCard]);

  // Drag handler
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const scale = useCanvasStore.getState().viewport.scale;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: card.x,
        origY: card.y,
      };
      const handleMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        updateCard(card.id, {
          x: dragRef.current.origX + (ev.clientX - dragRef.current.startX) / scale,
          y: dragRef.current.origY + (ev.clientY - dragRef.current.startY) / scale,
        });
      };
      const handleUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [card.id, card.x, card.y, updateCard],
  );

  // Resize handler
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const scale = useCanvasStore.getState().viewport.scale;
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origW: card.w,
        origH: card.h,
      };
      const handleMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        updateCard(card.id, {
          w: Math.max(400, resizeRef.current.origW + (ev.clientX - resizeRef.current.startX) / scale),
          h: Math.max(200, resizeRef.current.origH + (ev.clientY - resizeRef.current.startY) / scale),
        });
      };
      const handleUp = () => {
        resizeRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [card.id, card.w, card.h, updateCard],
  );

  // Navigate on Enter
  const handleUrlSubmit = () => {
    let url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    updateCard(card.id, { url });
    setUrlInput(url);
  };

  // Listen for batch delete
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.cardId === cardId) removeCard(card.id);
    };
    window.addEventListener("termcanvas:close-card", handler);
    return () => window.removeEventListener("termcanvas:close-card", handler);
  }, [cardId, card.id, removeCard]);

  return (
    <div
      className="absolute rounded-lg border border-[var(--border)] bg-[var(--surface)] flex flex-col overflow-hidden shadow-lg"
      style={{
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
      }}
    >
      {/* Title bar — draggable */}
      <div
        className="flex-none flex items-center gap-1.5 px-2 py-1.5 bg-[var(--bg)] border-b border-[var(--border)] cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleDragStart}
      >
        {/* Back / Forward / Refresh */}
        <button
          className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          onClick={() => webviewRef.current?.goBack()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          onClick={() => webviewRef.current?.goForward()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          onClick={() => webviewRef.current?.reload()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1.5 6a4.5 4.5 0 1 1 1 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M1.5 10.5V6H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* URL bar */}
        <input
          className="flex-1 min-w-0 px-2 py-0.5 text-[11px] rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] outline-none focus:border-[var(--text-secondary)]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleUrlSubmit();
          }}
          onMouseDown={(e) => e.stopPropagation()}
        />

        {/* Close */}
        <button
          className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          onClick={() => removeCard(card.id)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Webview */}
      <webview
        ref={webviewRef as React.Ref<Electron.WebviewTag>}
        src={card.url}
        className="flex-1 min-h-0"
        style={{ border: "none" }}
      />

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onMouseDown={handleResizeStart}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="absolute bottom-0.5 right-0.5 text-[var(--text-faint)]">
          <path d="M9 1L1 9M9 5L5 9M9 8L8 9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/BrowserCard.tsx
git commit -m "Add BrowserCard component with URL bar, navigation, drag and resize"
```

---

### Task 5: Enable Webview in Electron and Render BrowserCards on Canvas

**Files:**
- Modify: `electron/main.ts:57-61` (add `webviewTag: true`)
- Modify: `src/canvas/Canvas.tsx` (render BrowserCards)
- Modify: `src/toolbar/Toolbar.tsx` (add "Browser" button)
- Modify: `src/i18n/en.ts` (add label)
- Modify: `src/i18n/zh.ts` (add label)

**Step 1: Enable webview tag in Electron**

In `electron/main.ts`, add `webviewTag: true` to `webPreferences`:

```typescript
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
```

**Step 2: Render BrowserCards in Canvas**

In `src/canvas/Canvas.tsx`, add imports and render BrowserCards inside `#canvas-layer`:

```typescript
import { useBrowserCardStore } from "../stores/browserCardStore";
import { BrowserCard } from "../components/BrowserCard";
```

Inside the component, add:

```typescript
  const browserCards = useBrowserCardStore((s) => s.cards);
```

In the JSX, inside the `#canvas-layer` div, after the `projects.map()` block:

```tsx
        {Object.values(browserCards).map((card) => (
          <BrowserCard key={card.id} card={card} />
        ))}
```

**Step 3: Add "Browser" button to Toolbar**

In `src/toolbar/Toolbar.tsx`, add import:

```typescript
import { useBrowserCardStore } from "../stores/browserCardStore";
```

In the component body, add:

```typescript
  const addBrowserCard = useBrowserCardStore((s) => s.addCard);
```

Add a button in the toolbar, after the settings button (line 141) and before the zoom controls div:

```tsx
        {/* Add browser */}
        <button
          className={btn}
          style={noDrag}
          onClick={() => {
            const scale = viewport.scale;
            const x = (-viewport.x + window.innerWidth / 2) / scale - 400;
            const y = (-viewport.y + window.innerHeight / 2) / scale - 300;
            addBrowserCard("https://google.com", { x, y });
          }}
          title={t.add_browser}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M1.5 7h11M7 1.5c-1.5 2-2 3.5-2 5.5s.5 3.5 2 5.5M7 1.5c1.5 2 2 3.5 2 5.5s-.5 3.5-2 5.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
```

**Step 4: Add i18n labels**

In `src/i18n/en.ts`, add:

```typescript
  add_browser: "Open browser",
```

In `src/i18n/zh.ts`, add:

```typescript
  add_browser: "打开浏览器",
```

**Step 5: Verify**

Run: `npm run dev`
Click the globe icon in the toolbar. A BrowserCard should appear in the center of the viewport, showing google.com. Test:
- Drag the title bar to move the card
- Resize from the bottom-right corner
- Type a URL and press Enter to navigate
- Click back/forward/refresh buttons
- Click X to close
- Open multiple BrowserCards and verify they don't overlap

**Step 6: Commit**

```bash
git add electron/main.ts src/canvas/Canvas.tsx src/toolbar/Toolbar.tsx src/i18n/en.ts src/i18n/zh.ts
git commit -m "Wire BrowserCard into canvas and toolbar with webview support"
```

---

### Task 6: Persist BrowserCards in Workspace State

**Files:**
- Modify: `src/canvas/Canvas.tsx` or wherever `state:save` is called (look for `window.termcanvas.state.save`)
- Modify: wherever `state:load` is consumed (look for `window.termcanvas.state.load`)

**Step 1: Find save/load callsites**

Search for `state.save` and `state.load` usage in `src/` to find where canvas state is serialized. BrowserCard data needs to be included in that payload.

**Step 2: Add browserCards to save payload**

In the save handler, add `browserCards: useBrowserCardStore.getState().cards` to the saved state object.

**Step 3: Restore browserCards on load**

In the load handler, if `state.browserCards` exists, call `useBrowserCardStore.setState({ cards: state.browserCards })`.

**Step 4: Verify**

Open app, add a BrowserCard, close and reopen app. The BrowserCard should still be there at the same position with the same URL.

**Step 5: Commit**

```bash
git add <modified files>
git commit -m "Persist BrowserCard state across sessions"
```

---

### Task 7: Add Terminal Image Protocol Support

**Files:**
- Modify: `package.json` (add dependency)
- Modify: `src/terminal/TerminalTile.tsx` (load addon)

**Step 1: Install xterm-addon-image**

Run: `npm install xterm-addon-image`

**Step 2: Load the addon in TerminalTile**

In `src/terminal/TerminalTile.tsx`, add import:

```typescript
import { ImageAddon } from "xterm-addon-image";
```

After the WebGL addon block (added in Task 1), add:

```typescript
    try {
      const imageAddon = new ImageAddon();
      xterm.loadAddon(imageAddon);
    } catch {
      // Image protocol not available — not critical
    }
```

**Step 3: Verify**

Run: `npm run dev`
In a terminal tile, run a sixel-capable image viewer (install one if needed: `brew install chafa`). Then: `chafa some-image.png`. An image should render inline in the terminal.

**Step 4: Commit**

```bash
git add package.json package-lock.json src/terminal/TerminalTile.tsx
git commit -m "Add sixel image protocol support to terminal tiles"
```

---

## Task Dependency Graph

```
Task 1 (WebGL) ─────────────────────────────────────> standalone
Task 2 (lazygit) ───────────────────────────────────> standalone
Task 3 (BrowserCard store) ──> Task 4 (component) ──> Task 5 (wiring) ──> Task 6 (persistence)
Task 7 (terminal images) ──────────────────────────-> standalone (depends on Task 1 being done first)
```

Tasks 1, 2, 3 can be done in parallel. Task 7 should come after Task 1 (WebGL addon loading pattern is established).
