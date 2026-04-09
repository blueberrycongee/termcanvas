const INTRA_GROUP_GAP = 8;
const INTER_GROUP_GAP = 60;
const MAX_GROUP_COLS = 4;
const MAX_ROW_WIDTH = 3000;

export interface ClusterTile {
  id: string;
  width: number;
  height: number;
  tags: string[];
}

export interface Position {
  x: number;
  y: number;
}

export function packGroup(
  tiles: { id: string; width: number; height: number }[],
  originX: number,
  originY: number,
): Array<Position & { id: string }> {
  if (tiles.length === 0) {
    return [];
  }

  const result: Array<Position & { id: string }> = [];
  let rowX = originX;
  let rowY = originY;
  let rowMaxHeight = 0;
  let colIndex = 0;

  for (const tile of tiles) {
    if (colIndex >= MAX_GROUP_COLS && colIndex > 0) {
      rowY += rowMaxHeight + INTRA_GROUP_GAP;
      rowX = originX;
      rowMaxHeight = 0;
      colIndex = 0;
    }

    result.push({ id: tile.id, x: rowX, y: rowY });
    rowX += tile.width + INTRA_GROUP_GAP;
    rowMaxHeight = Math.max(rowMaxHeight, tile.height);
    colIndex += 1;
  }

  return result;
}

function groupBounds(
  positions: Array<Position & { id: string }>,
  tilesById: Map<string, { width: number; height: number }>,
): { x: number; y: number; w: number; h: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const pos of positions) {
    const tile = tilesById.get(pos.id);
    if (!tile) {
      continue;
    }
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + tile.width);
    maxY = Math.max(maxY, pos.y + tile.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

export function clusterByTag(
  tiles: ClusterTile[],
  tagPrefix: string,
): Map<string, Position> {
  if (tiles.length === 0) {
    return new Map();
  }

  const groups = new Map<string, ClusterTile[]>();
  const ungrouped: ClusterTile[] = [];

  for (const tile of tiles) {
    const tag = tile.tags.find((entry) => entry.startsWith(`${tagPrefix}:`));
    if (!tag) {
      ungrouped.push(tile);
      continue;
    }

    const existing = groups.get(tag);
    if (existing) {
      existing.push(tile);
      continue;
    }

    groups.set(tag, [tile]);
  }

  if (ungrouped.length > 0) {
    groups.set("__ungrouped__", ungrouped);
  }

  const result = new Map<string, Position>();
  const tilesById = new Map(
    tiles.map((tile) => [tile.id, { width: tile.width, height: tile.height }]),
  );
  let cursorX = 0;
  let cursorY = 0;
  let rowMaxHeight = 0;

  for (const groupTiles of groups.values()) {
    const packed = packGroup(groupTiles, cursorX, cursorY);
    const bounds = groupBounds(packed, tilesById);

    if (cursorX > 0 && cursorX + bounds.w > MAX_ROW_WIDTH) {
      cursorX = 0;
      cursorY += rowMaxHeight + INTER_GROUP_GAP;
      rowMaxHeight = 0;

      const wrapped = packGroup(groupTiles, cursorX, cursorY);
      const wrappedBounds = groupBounds(wrapped, tilesById);
      for (const pos of wrapped) {
        result.set(pos.id, { x: pos.x, y: pos.y });
      }
      cursorX += wrappedBounds.w + INTER_GROUP_GAP;
      rowMaxHeight = Math.max(rowMaxHeight, wrappedBounds.h);
      continue;
    }

    for (const pos of packed) {
      result.set(pos.id, { x: pos.x, y: pos.y });
    }
    cursorX += bounds.w + INTER_GROUP_GAP;
    rowMaxHeight = Math.max(rowMaxHeight, bounds.h);
  }

  return result;
}

export type ClusterRule =
  | "by-project"
  | "by-worktree"
  | "by-type"
  | "by-status"
  | "by-custom";

const RULE_TO_PREFIX: Record<ClusterRule, string> = {
  "by-custom": "custom",
  "by-project": "project",
  "by-status": "status",
  "by-type": "type",
  "by-worktree": "worktree",
};

export function cluster(tiles: ClusterTile[], rule: ClusterRule): Map<string, Position> {
  return clusterByTag(tiles, RULE_TO_PREFIX[rule]);
}
