import { app, screen, shell, clipboard, type BrowserWindow } from "electron";
import {
  type AppSnapshot,
  type DisplaySnapshot,
  type MainSnapshot,
  type ReportIssueRequest,
  type ReportIssueResult,
  type WindowSnapshot,
} from "../shared/diagnostics-snapshot";

const REPO_ISSUES_URL = "https://github.com/blueberrycongee/termcanvas/issues/new";

// GitHub's effective URL length cap is well below the protocol-level 8 KB:
// some browsers truncate around 2 KB, and `?body=...` becomes encoded so
// each char roughly doubles. 6000 mirrors VS Code's `MAX_URL_LENGTH` and
// has held up in practice.
const MAX_URL_LENGTH = 6000;

export async function collectMainSnapshot(
  window: BrowserWindow | null,
  renderDiagnosticsLogPath: string,
): Promise<MainSnapshot> {
  const appSnapshot: AppSnapshot = {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? "unknown",
    chromiumVersion: process.versions.chrome ?? "unknown",
    nodeVersion: process.versions.node ?? "unknown",
    platform: process.platform,
    arch: process.arch,
    locale: app.getLocale(),
  };

  let gpuFeatureStatus: Record<string, string> | null = null;
  try {
    const info = (await app.getGPUInfo("basic")) as {
      auxAttributes?: Record<string, unknown>;
      gpuDevice?: unknown;
      featureStatus?: Record<string, string>;
    };
    if (info && typeof info === "object" && info.featureStatus) {
      gpuFeatureStatus = info.featureStatus;
    }
  } catch {
    // GPU info is best-effort; some headless / sandboxed environments throw.
  }

  const displays: DisplaySnapshot[] = screen.getAllDisplays().map((display) => ({
    id: display.id,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    isPrimary: display.id === screen.getPrimaryDisplay().id,
    size: { width: display.size.width, height: display.size.height },
  }));

  const windowSnapshot: WindowSnapshot = window
    ? {
        isVisible: window.isVisible(),
        isFocused: window.isFocused(),
        isMinimized: window.isMinimized(),
        isFullScreen: window.isFullScreen(),
      }
    : {
        isVisible: false,
        isFocused: false,
        isMinimized: false,
        isFullScreen: false,
      };

  return {
    app: appSnapshot,
    gpuFeatureStatus,
    displays,
    window: windowSnapshot,
    renderDiagnosticsLogPath,
  };
}

export function buildIssueUrl(title: string, body: string): string {
  const params = new URLSearchParams({ title, body });
  return `${REPO_ISSUES_URL}?${params.toString()}`;
}

export async function openReportIssue(
  request: ReportIssueRequest,
): Promise<ReportIssueResult> {
  const url = buildIssueUrl(request.title, request.body);

  if (url.length <= MAX_URL_LENGTH) {
    try {
      await shell.openExternal(url);
      return { outcome: "url-opened" };
    } catch (error) {
      return {
        outcome: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // URL too long — copy body to clipboard and open the empty new-issue page.
  // Mirrors VS Code's third tier (`writeToClipboard`) in
  // `baseIssueReporterService.ts`.
  try {
    clipboard.writeText(`# ${request.title}\n\n${request.body}`);
    await shell.openExternal(REPO_ISSUES_URL);
    return { outcome: "clipboard-fallback" };
  } catch (error) {
    return {
      outcome: "error",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export { MAX_URL_LENGTH, REPO_ISSUES_URL };
