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
  viewportY: Record<string, number>;
  cellDimensions: Record<string, CellDimensions>;
  dismissedSegmentIds: Record<string, Set<number>>;
}

export const useSmartRenderStore = create<SmartRenderStoreState>(() => ({
  segments: {},
  viewportY: {},
  cellDimensions: {},
  dismissedSegmentIds: {},
}));

export function updateSegments(terminalId: string, segments: Segment[]): void {
  useSmartRenderStore.setState((state) => ({
    segments: { ...state.segments, [terminalId]: segments },
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
    const { [terminalId]: _v, ...viewportY } = state.viewportY;
    const { [terminalId]: _d, ...dismissedSegmentIds } = state.dismissedSegmentIds;
    return { segments, viewportY, dismissedSegmentIds };
  });
}
