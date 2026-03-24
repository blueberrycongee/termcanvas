import {
  COLLAPSED_TAB_WIDTH,
  RIGHT_PANEL_WIDTH,
} from "../stores/canvasStore.ts";

export const CANVAS_TOP_INSET = 44;

interface ViewportFrameOptions {
  rightPanelCollapsed: boolean;
}

interface FitScaleOptions extends ViewportFrameOptions {
  padding?: number;
  clampToOne?: boolean;
}

interface FocusScaleOptions extends FitScaleOptions {
  preserveCurrentScale?: boolean;
  currentScale?: number;
}

interface CenterTargetOptions extends ViewportFrameOptions {
  scale: number;
}

export function getCanvasViewportFrame(options: ViewportFrameOptions) {
  const rightInset = options.rightPanelCollapsed
    ? COLLAPSED_TAB_WIDTH
    : RIGHT_PANEL_WIDTH;
  const width = window.innerWidth - rightInset;
  const height = window.innerHeight - CANVAS_TOP_INSET;

  return {
    rightInset,
    width,
    height,
    centerX: width / 2,
    centerY: CANVAS_TOP_INSET + height / 2,
  };
}

export function getViewportFitScale(
  contentWidth: number,
  contentHeight: number,
  options: FitScaleOptions,
) {
  const frame = getCanvasViewportFrame(options);
  const padding = options.padding ?? 60;
  const availableWidth = frame.width - padding * 2;
  const availableHeight = frame.height - padding * 2;
  const scale = Math.min(
    availableWidth / contentWidth,
    availableHeight / contentHeight,
  );

  return options.clampToOne ? Math.min(1, scale) : scale;
}

export function getTerminalViewportScale(
  contentWidth: number,
  contentHeight: number,
  options: FocusScaleOptions,
) {
  if (options.preserveCurrentScale) {
    return options.currentScale ?? 1;
  }

  return getViewportFitScale(contentWidth, contentHeight, options) * 0.85;
}

export function getCenteredViewportTarget(
  absoluteX: number,
  absoluteY: number,
  contentWidth: number,
  contentHeight: number,
  options: CenterTargetOptions,
) {
  const frame = getCanvasViewportFrame(options);

  return {
    x: -(absoluteX + contentWidth / 2) * options.scale + frame.centerX,
    y: -(absoluteY + contentHeight / 2) * options.scale + frame.centerY,
  };
}
