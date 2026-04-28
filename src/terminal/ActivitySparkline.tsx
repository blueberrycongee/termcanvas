import { useCallback, useSyncExternalStore } from "react";
import {
  ACTIVITY_BUCKET_COUNT,
  getActivityBuckets,
  getActivityBucketsVersion,
  subscribeBucketUpdates,
} from "./terminalActivityTracker";

const BAR_GAP = 1;
const BAR_WIDTH = 3;
const MIN_BAR_PX = 1;
const SVG_HEIGHT = 10;
const SVG_WIDTH =
  ACTIVITY_BUCKET_COUNT * BAR_WIDTH + (ACTIVITY_BUCKET_COUNT - 1) * BAR_GAP;

interface Props {
  terminalId: string;
}

export function ActivitySparkline({ terminalId }: Props) {
  const subscribe = useCallback(
    (cb: () => void) =>
      subscribeBucketUpdates((id) => {
        if (id === terminalId) cb();
      }),
    [terminalId],
  );
  const getSnapshot = useCallback(
    () => getActivityBucketsVersion(terminalId),
    [terminalId],
  );
  // The snapshot is just a version counter; the bar data is read each
  // render. This deliberately couples re-renders to bucket-shift events
  // (every ~30s per terminal) rather than every PTY chunk.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const buckets = getActivityBuckets(terminalId);
  let max = 0;
  for (const v of buckets) if (v > max) max = v;

  return (
    <svg
      className="tc-activity-sparkline"
      width={SVG_WIDTH}
      height={SVG_HEIGHT}
      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      aria-hidden="true"
      role="presentation"
    >
      {buckets.map((value, i) => {
        // Newest bucket on the right matches sparkline convention; older
        // buckets fade to the left as time passes.
        const xIndex = ACTIVITY_BUCKET_COUNT - 1 - i;
        const x = xIndex * (BAR_WIDTH + BAR_GAP);
        const height =
          max > 0
            ? Math.max(MIN_BAR_PX, Math.round((value / max) * SVG_HEIGHT))
            : MIN_BAR_PX;
        const y = SVG_HEIGHT - height;
        return (
          <rect
            key={xIndex}
            x={x}
            y={y}
            width={BAR_WIDTH}
            height={height}
            rx={0.5}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}
