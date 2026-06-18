import { app, BrowserWindow, Notification } from "electron";
import type { BlockingEvent } from "../shared/blocking";

// Single point of contact with the OS notification API. Keeps Electron
// imports off the bus + telemetry layer so unit tests can stub this
// service freely.

export interface NotificationServiceDeps {
  getWindow: () => BrowserWindow | null;
}

export class NotificationService {
  // Keep one Notification instance per blocking-event id so we can
  // close() it when the block resolves; otherwise stale "needs approval"
  // toasts linger in the OS notification center after the user already
  // approved.
  private readonly outstanding = new Map<string, Notification>();

  constructor(private readonly deps: NotificationServiceDeps) {}

  showBlocking(event: BlockingEvent): void {
    if (!Notification.isSupported()) return;

    const title = formatTitle(event);
    const body = formatBody(event);

    const existing = this.outstanding.get(event.id);
    if (existing) {
      existing.close();
    }

    const notification = new Notification({
      title,
      body,
      silent: true,
      // macOS Alert style — stays visible until the user dismisses it.
      // Falls back to default banner on platforms that don't honor it.
      timeoutType: "never",
    });

    notification.on("click", () => {
      this.focusWindowAndJump(event.terminalId);
    });

    notification.on("close", () => {
      this.outstanding.delete(event.id);
    });

    notification.show();
    this.outstanding.set(event.id, notification);
  }

  closeBlocking(eventId: string): void {
    const existing = this.outstanding.get(eventId);
    if (!existing) return;
    existing.close();
    this.outstanding.delete(eventId);
  }

  // Public: also called by the IPC handler when the renderer triggers
  // a jump (toolbar dot click, inbox click).
  focusWindowAndJump(terminalId: string): void {
    const win = this.deps.getWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    // macOS only honors steal-focus through app.focus when the app is
    // in the background; on other platforms it's a noop.
    if (process.platform === "darwin") {
      app.focus({ steal: true });
    }
    win?.webContents.send("blocking:jump-to-terminal", { terminalId });
  }
}

function formatTitle(event: BlockingEvent): string {
  // {project} · {terminal} — three-part rule with graceful degradation
  // when either label is missing (fresh terminals before scan completes).
  const parts: string[] = [];
  if (event.projectName) parts.push(event.projectName);
  if (event.terminalTitle) parts.push(event.terminalTitle);
  return parts.length > 0 ? parts.join(" · ") : "Agent waiting";
}

function formatBody(event: BlockingEvent): string {
  switch (event.kind) {
    case "approval":
      return "Waiting for your approval";
  }
}
