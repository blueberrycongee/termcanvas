// Snapshot schema for `Help → Report Issue`.
//
// WHY snapshot, not a Sentry-style breadcrumb / ring buffer of recent events:
// the field set here is fixed, narrow, and reviewable in one place. An
// open event log requires per-event privacy review forever — a future
// contributor could land an event that captures a window title or a path
// and we'd have no structural defense. By keeping diagnostics to a typed
// snapshot built from a closed allowlist, "no labels / no paths / no PTY
// content" becomes a property of the schema, not of contributor discipline.
// (See VS Code's `baseIssueReporterService.ts` for the same shape — they
// submit snapshots, not their rotating logs. Their logs exist on disk and
// the user attaches them manually if relevant.)
//
// Allowed fields below: enums, booleans, numbers, internal UUIDs, version
// strings, GPU feature names. Forbidden fields (by design — do not add):
// window titles, terminal labels, cwd / worktree paths, file names, ANSI
// or PTY content, command lines, URLs the user is visiting.

export const DIAGNOSTICS_SNAPSHOT_SCHEMA_VERSION =
  "termcanvas/diagnostics-snapshot/v0.1" as const;

export interface AppSnapshot {
  appVersion: string;
  electronVersion: string;
  chromiumVersion: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  locale: string;
}

export interface DisplaySnapshot {
  id: number;
  scaleFactor: number;
  rotation: number;
  isPrimary: boolean;
  size: { width: number; height: number };
}

export interface WindowSnapshot {
  isVisible: boolean;
  isFocused: boolean;
  isMinimized: boolean;
  isFullScreen: boolean;
}

export interface TerminalSnapshot {
  // Internal UUID, not user-visible.
  id: string;
  rendererMode: "webgl" | "canvas" | "dom";
  // High-level enum; value space is closed (e.g. "idle" | "running" | "exited").
  status: string;
  // Mount mode; value space is closed (e.g. "headless" | "attached").
  mode: string;
  hasXterm: boolean;
  isAttached: boolean;
  isFocused: boolean;
  cols: number | null;
  rows: number | null;
}

export interface WebGLPoolSnapshot {
  poolSize: number;
  maxContexts: number;
  focusedTerminalId: string | null;
  trackedTerminalIds: string[];
  contextLossCount: number;
  lastContextLossAt: string | null;
}

export interface RendererSnapshot {
  visibilityState: string;
  documentFocused: boolean;
  devicePixelRatio: number;
  innerWidth: number;
  innerHeight: number;
  terminals: TerminalSnapshot[];
  webglPool: WebGLPoolSnapshot;
}

export interface MainSnapshot {
  app: AppSnapshot;
  gpuFeatureStatus: Record<string, string> | null;
  displays: DisplaySnapshot[];
  window: WindowSnapshot;
  renderDiagnosticsLogPath: string;
}

export interface DiagnosticsSnapshot {
  schema_version: typeof DIAGNOSTICS_SNAPSHOT_SCHEMA_VERSION;
  captured_at: string;
  main: MainSnapshot;
  renderer: RendererSnapshot;
}

export interface ReportIssueRequest {
  title: string;
  body: string;
}

export interface ReportIssueResult {
  // "url-opened" = browser opened with body in querystring.
  // "clipboard-fallback" = body was too long, copied to clipboard and an
  // empty new-issue page was opened with a notice in the URL hint.
  outcome: "url-opened" | "clipboard-fallback" | "error";
  errorMessage?: string;
}

export function buildSnapshot(
  main: MainSnapshot,
  renderer: RendererSnapshot,
  now: () => string = () => new Date().toISOString(),
): DiagnosticsSnapshot {
  return {
    schema_version: DIAGNOSTICS_SNAPSHOT_SCHEMA_VERSION,
    captured_at: now(),
    main,
    renderer,
  };
}

export function buildIssueBody(snapshot: DiagnosticsSnapshot): string {
  const lines: string[] = [];

  lines.push("<!-- Describe what happened above this line. -->");
  lines.push("");
  lines.push("## Diagnostics");
  lines.push("");
  lines.push("<details><summary>System</summary>");
  lines.push("");
  lines.push("```");
  lines.push(`schema: ${snapshot.schema_version}`);
  lines.push(`captured_at: ${snapshot.captured_at}`);
  lines.push(`app: ${snapshot.main.app.appVersion}`);
  lines.push(`electron: ${snapshot.main.app.electronVersion}`);
  lines.push(`chromium: ${snapshot.main.app.chromiumVersion}`);
  lines.push(`node: ${snapshot.main.app.nodeVersion}`);
  lines.push(
    `platform: ${snapshot.main.app.platform}/${snapshot.main.app.arch}`,
  );
  lines.push(`locale: ${snapshot.main.app.locale}`);
  lines.push("```");
  lines.push("");
  lines.push("</details>");

  if (snapshot.main.gpuFeatureStatus) {
    lines.push("");
    lines.push("<details><summary>GPU feature status</summary>");
    lines.push("");
    lines.push("```");
    for (const [key, value] of Object.entries(
      snapshot.main.gpuFeatureStatus,
    )) {
      lines.push(`${key}: ${value}`);
    }
    lines.push("```");
    lines.push("");
    lines.push("</details>");
  }

  lines.push("");
  lines.push("<details><summary>Window & displays</summary>");
  lines.push("");
  lines.push("```");
  const w = snapshot.main.window;
  lines.push(
    `window: visible=${w.isVisible} focused=${w.isFocused} minimized=${w.isMinimized} fullscreen=${w.isFullScreen}`,
  );
  for (const d of snapshot.main.displays) {
    lines.push(
      `display ${d.id}: ${d.size.width}x${d.size.height} @${d.scaleFactor}x rot=${d.rotation} primary=${d.isPrimary}`,
    );
  }
  const r = snapshot.renderer;
  lines.push(
    `renderer: visibility=${r.visibilityState} focused=${r.documentFocused} dpr=${r.devicePixelRatio} ${r.innerWidth}x${r.innerHeight}`,
  );
  lines.push("```");
  lines.push("");
  lines.push("</details>");

  lines.push("");
  lines.push("<details><summary>Terminals</summary>");
  lines.push("");
  lines.push("```");
  if (snapshot.renderer.terminals.length === 0) {
    lines.push("(no terminals)");
  }
  for (const t of snapshot.renderer.terminals) {
    lines.push(
      `${t.id} renderer=${t.rendererMode} status=${t.status} mode=${t.mode} attached=${t.isAttached} focused=${t.isFocused} xterm=${t.hasXterm} size=${t.cols ?? "?"}x${t.rows ?? "?"}`,
    );
  }
  const pool = snapshot.renderer.webglPool;
  lines.push("");
  lines.push(
    `webgl pool: ${pool.poolSize}/${pool.maxContexts} focused=${pool.focusedTerminalId ?? "none"}`,
  );
  lines.push(
    `webgl context loss: count=${pool.contextLossCount} last=${pool.lastContextLossAt ?? "never"}`,
  );
  lines.push("```");
  lines.push("");
  lines.push("</details>");

  lines.push("");
  lines.push(
    `Render diagnostics log (not auto-attached — paste manually if relevant): \`${snapshot.main.renderDiagnosticsLogPath}\``,
  );

  return lines.join("\n");
}
