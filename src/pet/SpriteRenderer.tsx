import { memo, useMemo } from "react";
import type { SpriteFrame } from "./sprites";
import { PET_PIXEL_SIZE, SPRITE_GRID_SIZE } from "./constants";

const PIXEL_SIZE = PET_PIXEL_SIZE;
const GRID_SIZE = SPRITE_GRID_SIZE;

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
      {rects.map(({ rx, ry, color }) => (
        <rect
          key={`${rx}-${ry}`}
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
