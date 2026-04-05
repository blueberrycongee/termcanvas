import { BrowserCard } from "../components/BrowserCard";
import { FileCard } from "../components/FileCard";
import { useCanvasStore } from "../stores/canvasStore";
import { useBrowserCardStore } from "../stores/browserCardStore";
import { useFileCardStore } from "../stores/fileCardStore";

export function CanvasCardLayer() {
  const viewport = useCanvasStore((state) => state.viewport);
  const browserCards = useBrowserCardStore((state) => Object.values(state.cards));
  const fileCards = useFileCardStore((state) => Object.values(state.cards));

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
