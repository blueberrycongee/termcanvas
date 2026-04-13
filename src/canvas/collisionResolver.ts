export interface CollisionRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CollisionResolution {
  resolved: CollisionRect[];
  positionsById: Map<string, { x: number; y: number }>;
}

function rectsOverlap(a: CollisionRect, b: CollisionRect, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function center(rect: CollisionRect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export function resolveCollisionsDetailed(
  rects: CollisionRect[],
  gap: number,
  anchorIds: string[] = [],
): CollisionResolution {
  const result = rects.map((rect) => ({ ...rect }));
  const anchored = new Set(anchorIds);
  const maxIterations = 20;

  for (let iter = 0; iter < maxIterations; iter += 1) {
    let anyMoved = false;

    for (let i = 0; i < result.length; i += 1) {
      for (let j = i + 1; j < result.length; j += 1) {
        const a = result[i];
        const b = result[j];
        if (!rectsOverlap(a, b, gap)) {
          continue;
        }

        const aCenter = center(a);
        const bCenter = center(b);
        const deltaX = bCenter.x - aCenter.x;
        const deltaY = bCenter.y - aCenter.y;

        const overlapX =
          (a.width + b.width) / 2 + gap - Math.abs(deltaX);
        const overlapY =
          (a.height + b.height) / 2 + gap - Math.abs(deltaY);

        if (overlapX <= 0 || overlapY <= 0) {
          continue;
        }

        const aAnchored = anchored.has(a.id);
        const bAnchored = anchored.has(b.id);

        if (overlapX < overlapY) {
          const direction = deltaX >= 0 ? 1 : -1;
          const move = overlapX;
          if (aAnchored && !bAnchored) {
            b.x += direction * move;
          } else if (bAnchored && !aAnchored) {
            a.x -= direction * move;
          } else if (aAnchored && bAnchored) {
            continue;
          } else {
            a.x -= direction * (move / 2);
            b.x += direction * (move / 2);
          }
        } else {
          const direction = deltaY >= 0 ? 1 : -1;
          const move = overlapY;
          if (aAnchored && !bAnchored) {
            b.y += direction * move;
          } else if (bAnchored && !aAnchored) {
            a.y -= direction * move;
          } else if (aAnchored && bAnchored) {
            continue;
          } else {
            a.y -= direction * (move / 2);
            b.y += direction * (move / 2);
          }
        }

        anyMoved = true;
      }
    }

    if (!anyMoved) {
      break;
    }
  }

  return {
    resolved: result,
    positionsById: new Map(result.map((rect) => [rect.id, { x: rect.x, y: rect.y }])),
  };
}

export function resolveCollisions(
  rects: CollisionRect[],
  gap: number,
  anchorId?: string,
): CollisionRect[] {
  return resolveCollisionsDetailed(
    rects,
    gap,
    anchorId ? [anchorId] : [],
  ).resolved;
}
