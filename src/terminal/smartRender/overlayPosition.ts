interface PositionInput {
  segmentStartLine: number;
  segmentLineCount: number;
  viewportY: number;
  cellHeight: number;
  cellWidth: number;
  viewportCols: number;
  padding: number;
}

interface OverlayPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

const VIEWPORT_BUFFER_LINES = 50;

export function calculateOverlayPosition(input: PositionInput): OverlayPosition {
  const viewportRow = input.segmentStartLine - input.viewportY;
  return {
    top: viewportRow * input.cellHeight,
    left: 0,
    width: input.viewportCols * input.cellWidth,
    height: input.segmentLineCount * input.cellHeight,
  };
}

export function isInViewport(
  segmentStartLine: number,
  segmentLineCount: number,
  viewportY: number,
  viewportRows: number,
  buffer: number = VIEWPORT_BUFFER_LINES,
): boolean {
  const segmentEnd = segmentStartLine + segmentLineCount;
  const viewportStart = viewportY - buffer;
  const viewportEnd = viewportY + viewportRows + buffer;
  return segmentEnd > viewportStart && segmentStartLine < viewportEnd;
}
