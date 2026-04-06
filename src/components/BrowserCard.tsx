/// <reference types="electron" />

import { useEffect, useRef, useCallback, useState } from "react";
import {
  removeBrowserCardFromScene,
  updateBrowserCardInScene,
} from "../actions/sceneCardActions";
import { activateCardInScene } from "../actions/sceneSelectionActions";
import {
  type BrowserCardData,
} from "../stores/browserCardStore";
import { useCardLayoutStore } from "../stores/cardLayoutStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useSelectionStore } from "../stores/selectionStore";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          allowpopups?: boolean;
          preload?: string;
        },
        HTMLElement
      >;
    }
  }
}

interface Props {
  card: BrowserCardData;
}

export function BrowserCard({ card }: Props) {
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
  const isSelected = useSelectionStore((state) =>
    state.selectedItems.some(
      (item) => item.type === "card" && item.cardId === cardId,
    ),
  );

  useEffect(() => {
    register(cardId, { x: card.x, y: card.y, w: card.w, h: card.h });
    return () => unregister(cardId);
  }, [card.h, card.w, card.x, card.y, cardId, register, unregister]);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onTitle = (e: Electron.PageTitleUpdatedEvent) => {
      updateBrowserCardInScene(card.id, { title: e.title });
    };
    const onNavigate = ((e: Event & { url: string }) => {
      setUrlInput(e.url);
      setLoadError(null);
    }) as EventListener;
    const onFailLoad = ((e: Event & {
      errorCode: number;
      errorDescription: string;
      isMainFrame: boolean;
    }) => {
      if (!e.isMainFrame || e.errorCode === -3) return;
      setLoadError(e.errorDescription);
    }) as EventListener;
    wv.addEventListener("page-title-updated", onTitle);
    wv.addEventListener("did-navigate", onNavigate);
    wv.addEventListener("did-navigate-in-page", onNavigate);
    wv.addEventListener("did-fail-load", onFailLoad);
    return () => {
      wv.removeEventListener("page-title-updated", onTitle);
      wv.removeEventListener("did-navigate", onNavigate);
      wv.removeEventListener("did-navigate-in-page", onNavigate);
      wv.removeEventListener("did-fail-load", onFailLoad);
    };
  }, [card.id]);

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
        updateBrowserCardInScene(card.id, {
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
    [card.id, card.x, card.y],
  );

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
        updateBrowserCardInScene(card.id, {
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
    [card.id, card.w, card.h],
  );

  const handleUrlSubmit = () => {
    let url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    updateBrowserCardInScene(card.id, { url });
    setUrlInput(url);
  };

  return (
    <div
      data-scene-box-select-block
      className="absolute rounded-lg border border-[var(--border)] bg-[var(--surface)] flex flex-col overflow-hidden shadow-lg"
      style={{
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        outline: isSelected ? "2px solid var(--accent)" : undefined,
        outlineOffset: isSelected ? -2 : undefined,
      }}
      onMouseDownCapture={(e) => {
        e.stopPropagation();
        activateCardInScene(cardId);
      }}
    >
      <div
        className="flex-none flex items-center gap-1.5 px-2 py-1.5 bg-[var(--bg)] border-b border-[var(--border)] cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleDragStart}
      >
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

        <button
          className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          onClick={() => removeBrowserCardFromScene(card.id)}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 relative">
        <webview
          ref={webviewRef as React.Ref<HTMLElement>}
          src={card.url}
          partition="persist:browser"
          allowpopups
          className="w-full h-full"
          style={{ border: "none" }}
        />
        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--surface)] text-[var(--text-muted)]">
            <p className="text-sm mb-2">Failed to load page</p>
            <p className="text-xs opacity-60 mb-3 max-w-[300px] text-center">{loadError}</p>
            <button
              className="text-xs px-3 py-1 rounded border border-[var(--border)] hover:bg-[var(--bg)] transition-colors"
              onClick={() => { setLoadError(null); webviewRef.current?.reload(); }}
            >
              Retry
            </button>
          </div>
        )}
      </div>

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
