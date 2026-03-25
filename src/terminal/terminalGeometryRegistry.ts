export interface TerminalGeometry {
  terminalId: string;
  projectId: string;
  worktreeId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const geometryRegistry = new Map<string, TerminalGeometry>();

export function publishTerminalGeometry(geometry: TerminalGeometry): void {
  geometryRegistry.set(geometry.terminalId, geometry);
}

export function unpublishTerminalGeometry(terminalId: string): void {
  geometryRegistry.delete(terminalId);
}

export function getTerminalGeometry(
  terminalId: string,
): TerminalGeometry | null {
  return geometryRegistry.get(terminalId) ?? null;
}

export function clearTerminalGeometryRegistry(): void {
  geometryRegistry.clear();
}
