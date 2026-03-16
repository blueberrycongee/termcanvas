export interface WindowSendTarget {
  isDestroyed?: () => boolean;
  webContents?: {
    isDestroyed?: () => boolean;
    send: (channel: string, ...args: unknown[]) => void;
  };
}

export function canSendToWindow(
  win: WindowSendTarget | null | undefined,
): win is WindowSendTarget & {
  webContents: NonNullable<WindowSendTarget["webContents"]>;
} {
  if (!win) return false;
  if (typeof win.isDestroyed === "function" && win.isDestroyed()) return false;
  if (!win.webContents) return false;
  if (
    typeof win.webContents.isDestroyed === "function" &&
    win.webContents.isDestroyed()
  ) {
    return false;
  }
  return true;
}

export function sendToWindow(
  win: WindowSendTarget | null | undefined,
  channel: string,
  ...args: unknown[]
): boolean {
  if (!canSendToWindow(win)) return false;
  win.webContents.send(channel, ...args);
  return true;
}
