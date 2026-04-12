import { useMemo } from "react";
import { BrowserCard } from "../components/BrowserCard";
import { FileCard } from "../components/FileCard";
import { useCanvasStore } from "../stores/canvasStore";
import { useBrowserCardStore } from "../stores/browserCardStore";
import { useFileCardStore } from "../stores/fileCardStore";
import { usePreferencesStore } from "../stores/preferencesStore";

export function CanvasCardLayer() {
  const viewport = useCanvasStore((state) => state.viewport);
  const isAnimating = useCanvasStore((state) => state.isAnimating);
  const browserCardMap = useBrowserCardStore((state) => state.cards);
  const fileCardMap = useFileCardStore((state) => state.cards);
  const animationBlur = usePreferencesStore((state) => state.animationBlur);
  const browserCards = useMemo(
    () => Object.values(browserCardMap),
    [browserCardMap],
  );
  const fileCards = useMemo(
    () => Object.values(fileCardMap),
    [fileCardMap],
  );

  if (browserCards.length === 0 && fileCards.length === 0) {
    return null;
  }

  return (
    <div
      id="canvas-card-layer"
      className="absolute inset-0"
      style={{ pointerEvents: "none" }}
    >
      <div
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          transformOrigin: "0 0",
          willChange: isAnimating ? "transform" : undefined,
          filter:
            animationBlur > 0 && isAnimating ? `blur(${animationBlur}px)` : "none",
          transition: animationBlur > 0 ? "filter 0.15s ease" : "none",
        }}
      >
        {browserCards.map((card) => (
          <div key={card.id} style={{ pointerEvents: "auto" }}>
            <BrowserCard card={card} />
          </div>
        ))}
        {fileCards.map((card) => (
          <div key={card.id} style={{ pointerEvents: "auto" }}>
            <FileCard card={card} />
          </div>
        ))}
      </div>
    </div>
  );
}
