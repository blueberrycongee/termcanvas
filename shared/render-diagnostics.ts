export const RENDER_DIAGNOSTICS_SCHEMA_VERSION =
  "termcanvas/render-diagnostics/v0.1" as const;

export interface RenderDiagnosticEventInput {
  kind: string;
  terminalId?: string;
  data?: Record<string, unknown>;
}

export interface RenderDiagnosticLogEntry {
  schema_version: typeof RENDER_DIAGNOSTICS_SCHEMA_VERSION;
  logged_at: string;
  source: "renderer" | "main";
  kind: string;
  terminal_id?: string;
  data: Record<string, unknown>;
}

export interface RenderDiagnosticsLogInfo {
  filePath: string;
}
