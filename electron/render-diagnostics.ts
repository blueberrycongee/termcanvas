import fs from "node:fs";
import path from "node:path";
import {
  RENDER_DIAGNOSTICS_SCHEMA_VERSION,
  type RenderDiagnosticEventInput,
  type RenderDiagnosticLogEntry,
  type RenderDiagnosticsLogInfo,
} from "../shared/render-diagnostics";

type RenderDiagnosticSource = RenderDiagnosticLogEntry["source"];

export class RenderDiagnosticsLogger {
  constructor(
    private readonly filePath: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  getLogInfo(): RenderDiagnosticsLogInfo {
    return {
      filePath: this.filePath,
    };
  }

  recordRendererEvent(input: RenderDiagnosticEventInput): void {
    this.record("renderer", input);
  }

  recordMainEvent(
    kind: string,
    data: Record<string, unknown> = {},
    terminalId?: string,
  ): void {
    this.record("main", {
      kind,
      terminalId,
      data,
    });
  }

  private record(
    source: RenderDiagnosticSource,
    input: RenderDiagnosticEventInput,
  ): void {
    const entry: RenderDiagnosticLogEntry = {
      schema_version: RENDER_DIAGNOSTICS_SCHEMA_VERSION,
      logged_at: this.now(),
      source,
      kind: input.kind,
      terminal_id: input.terminalId,
      data: {
        process_pid: process.pid,
        ...(input.data ?? {}),
      },
    };

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, "utf-8");
    } catch {
      // Diagnostics logging must never disturb app behavior.
    }
  }
}

export function createRenderDiagnosticsLogger(
  userDataPath: string,
): RenderDiagnosticsLogger {
  return new RenderDiagnosticsLogger(
    path.join(userDataPath, "logs", "render-diagnostics.jsonl"),
  );
}
