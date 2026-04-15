import { memo, useMemo } from "react";
import type { SpriteFrame } from "./sprites";

const PIXEL_SIZE = 2; // Each sprite pixel = 2 screen pixels → 24×2 = 48px pet
const GRID_SIZE = 24;

interface SpriteRendererProps {
  frame: SpriteFrame;
  x: number;
  y: number;
  flipX?: boolean;
  opacity?: number;
}

export const SpriteRenderer = memo(function SpriteRenderer({
  frame,
  x,
  y,
  flipX = false,
  opacity = 1,
}: SpriteRendererProps) {
  const rects = useMemo(() => {
    const result: { rx: number; ry: number; color: string }[] = [];
    for (let row = 0; row < frame.length; row++) {
      for (let col = 0; col < frame[row].length; col++) {
        const color = frame[row][col];
        if (color) {
          result.push({ rx: col, ry: row, color });
        }
      }
    }
    return result;
  }, [frame]);

  const transform = flipX
    ? `translate(${x + GRID_SIZE * PIXEL_SIZE}, ${y}) scale(-1, 1)`
    : `translate(${x}, ${y})`;

  return (
    <g transform={transform} opacity={opacity}>
      {rects.map(({ rx, ry, color }, i) => (
        <rect
          key={i}
          x={rx * PIXEL_SIZE}
          y={ry * PIXEL_SIZE}
          width={PIXEL_SIZE}
          height={PIXEL_SIZE}
          fill={color}
        />
      ))}
    </g>
  );
});

export { PIXEL_SIZE, GRID_SIZE };
