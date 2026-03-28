import { create } from "zustand";
import type { Segment } from "./types";

export interface CellDimensions {
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
}

interface SmartRenderStoreState {
  segments: Record<string, Segment[]>;
  segmentVersion: Record<string, number>;
  viewportY: Record<string, number>;
  cellDimensions: Record<string, CellDimensions>;
  dismissedSegmentIds: Record<string, Set<number>>;
}

export const useSmartRenderStore = create<SmartRenderStoreState>(() => ({
  segments: {},
  segmentVersion: {},
  viewportY: {},
  cellDimensions: {},
  dismissedSegmentIds: {},
}));

export function updateSegments(terminalId: string, segments: readonly Segment[]): void {
  useSmartRenderStore.setState((state) => ({
    segments: { ...state.segments, [terminalId]: segments as Segment[] },
    segmentVersion: {
      ...state.segmentVersion,
      [terminalId]: (state.segmentVersion[terminalId] ?? 0) + 1,
    },
  }));
}

export function updateViewportY(terminalId: string, y: number): void {
  useSmartRenderStore.setState((state) => ({
    viewportY: { ...state.viewportY, [terminalId]: y },
  }));
}

export function dismissSegment(terminalId: string, segmentId: number): void {
  useSmartRenderStore.setState((state) => {
    const existing = state.dismissedSegmentIds[terminalId] ?? new Set();
    const updated = new Set(existing);
    updated.add(segmentId);
    return { dismissedSegmentIds: { ...state.dismissedSegmentIds, [terminalId]: updated } };
  });
}

export function updateCellDimensions(terminalId: string, dims: CellDimensions): void {
  useSmartRenderStore.setState((state) => ({
    cellDimensions: { ...state.cellDimensions, [terminalId]: dims },
  }));
}

export function clearSmartRender(terminalId: string): void {
  useSmartRenderStore.setState((state) => {
    const { [terminalId]: _s, ...segments } = state.segments;
    const { [terminalId]: _sv, ...segmentVersion } = state.segmentVersion;
    const { [terminalId]: _v, ...viewportY } = state.viewportY;
    const { [terminalId]: _c, ...cellDimensions } = state.cellDimensions;
    const { [terminalId]: _d, ...dismissedSegmentIds } = state.dismissedSegmentIds;
    return { segments, segmentVersion, viewportY, cellDimensions, dismissedSegmentIds };
  });
}
