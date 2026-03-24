const MIN_ANIMATION_DURATION_MS = 220;
const MAX_ANIMATION_DURATION_MS = 520;
const DISTANCE_DURATION_FACTOR = 0.08;
const SCALE_DURATION_FACTOR = 120;

interface ViewportAnimationDurationOptions {
  startX: number;
  startY: number;
  startScale: number;
  targetX: number;
  targetY: number;
  targetScale: number;
}

export function getViewportAnimationDuration(
  options: ViewportAnimationDurationOptions,
) {
  const distance = Math.hypot(
    options.targetX - options.startX,
    options.targetY - options.startY,
  );
  const startScale = Math.max(options.startScale, 0.001);
  const targetScale = Math.max(options.targetScale, 0.001);
  const scaleDelta = Math.abs(Math.log2(targetScale / startScale));
  const duration =
    MIN_ANIMATION_DURATION_MS +
    distance * DISTANCE_DURATION_FACTOR +
    scaleDelta * SCALE_DURATION_FACTOR;

  return Math.min(
    MAX_ANIMATION_DURATION_MS,
    Math.max(MIN_ANIMATION_DURATION_MS, duration),
  );
}

export function easeInOutCubic(progress: number) {
  if (progress < 0.5) {
    return 4 * progress * progress * progress;
  }

  return 1 - Math.pow(-2 * progress + 2, 3) / 2;
}
