import { useCallback } from "react";
import { useSmartRenderStore, dismissSegment } from "./smartRenderStore";
import { calculateOverlayPosition, isInViewport } from "./overlayPosition";
import {
  CodeBlockOverlay,
  MarkdownOverlay,
  DiffOverlay,
  ThinkingOverlay,
  ToolCallOverlay,
} from "./overlays";
import type { Segment } from "./types";

interface Props {
  terminalId: string;
}

export function SmartRenderOverlay({ terminalId }: Props) {
  const segments = useSmartRenderStore((s) => s.segments[terminalId]);
  const viewportY = useSmartRenderStore((s) => s.viewportY[terminalId] ?? 0);
  const dims = useSmartRenderStore((s) => s.cellDimensions[terminalId]);
  const dismissed = useSmartRenderStore((s) => s.dismissedSegmentIds[terminalId]);

  const handleDismiss = useCallback(
    (segmentId: number) => dismissSegment(terminalId, segmentId),
    [terminalId],
  );

  if (!segments?.length || !dims) return null;

  const visibleSegments = segments.filter(
    (s) =>
      !(dismissed?.has(s.id)) &&
      s.type !== "raw" &&
      isInViewport(s.startLine, s.lineCount, viewportY, dims.rows),
  );

  if (!visibleSegments.length) return null;

  return (
    <div
      className="absolute pointer-events-none overflow-hidden z-10"
      style={{ inset: 4 }}
    >
      {visibleSegments.map((segment) => {
        const pos = calculateOverlayPosition({
          segmentStartLine: segment.startLine,
          segmentLineCount: segment.lineCount,
          viewportY,
          cellHeight: dims.cellHeight,
          cellWidth: dims.cellWidth,
          viewportCols: dims.cols,
          padding: 4,
        });

        return (
          <div
            key={segment.id}
            className="absolute left-0 right-0"
            style={{
              top: pos.top,
              height: pos.height,
              minHeight: pos.height,
            }}
          >
            <OverlayContent
              segment={segment}
              onDismiss={() => handleDismiss(segment.id)}
            />
          </div>
        );
      })}
    </div>
  );
}

function OverlayContent({
  segment,
  onDismiss,
}: {
  segment: Segment;
  onDismiss: () => void;
}) {
  switch (segment.type) {
    case "code_block":
      return (
        <CodeBlockOverlay
          content={segment.content}
          language={segment.meta?.language}
          status={segment.status}
          onDismiss={onDismiss}
        />
      );
    case "markdown":
      return <MarkdownOverlay content={segment.content} onDismiss={onDismiss} />;
    case "diff":
      return <DiffOverlay content={segment.content} onDismiss={onDismiss} />;
    case "thinking":
      return (
        <ThinkingOverlay
          content={segment.content}
          status={segment.status}
          onDismiss={onDismiss}
        />
      );
    case "tool_call":
      return (
        <ToolCallOverlay
          content={segment.content}
          toolName={segment.meta?.toolName}
          status={segment.status}
          onDismiss={onDismiss}
        />
      );
    default:
      return null;
  }
}
