import fs from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import type { Pin } from "../shared/pin";
import {
  PIN_RENDER_MAX_HEIGHT,
  PIN_RENDER_MAX_WIDTH,
  buildPinRenderHtml,
  normalizePinRenderOptions,
  type PinRenderOptionsInput,
} from "./pin-render-utils";

export interface PinRenderResult {
  ok: true;
  pin_id: string;
  title: string;
  repo: string;
  image_path: string;
  width: number;
  height: number;
  full_page: boolean;
  mime_type: "image/png";
  bytes: number;
  generated_at: string;
}

export async function renderPinToPng(
  pin: Pin,
  input: PinRenderOptionsInput = {},
): Promise<PinRenderResult> {
  const options = normalizePinRenderOptions(pin.repo, pin.id, input);
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  removeStaleTempFiles(path.dirname(options.outputPath));

  const win = new BrowserWindow({
    show: false,
    paintWhenInitiallyHidden: true,
    width: options.width,
    height: options.height,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
    },
  });

  try {
    const html = buildPinRenderHtml(pin);
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await delay(options.waitMs);

    let captureWidth = options.width;
    let captureHeight = options.height;
    if (options.fullPage) {
      const pageSize = await getPageSize(win);
      captureWidth = Math.min(PIN_RENDER_MAX_WIDTH, Math.max(options.width, pageSize.width));
      captureHeight = Math.min(PIN_RENDER_MAX_HEIGHT, Math.max(options.height, pageSize.height));
      win.setSize(captureWidth, captureHeight, false);
      await delay(50);
    }

    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    const tmp = `${options.outputPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, png);
    fs.renameSync(tmp, options.outputPath);

    return {
      ok: true,
      pin_id: pin.id,
      title: pin.title,
      repo: pin.repo,
      image_path: options.outputPath,
      width: captureWidth,
      height: captureHeight,
      full_page: options.fullPage,
      mime_type: "image/png",
      bytes: png.length,
      generated_at: new Date().toISOString(),
    };
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

async function getPageSize(
  win: BrowserWindow,
): Promise<{ width: number; height: number }> {
  const result = await win.webContents.executeJavaScript(
    `(() => ({
      width: Math.ceil(Math.max(
        document.documentElement?.scrollWidth || 0,
        document.body?.scrollWidth || 0,
        window.innerWidth || 0
      )),
      height: Math.ceil(Math.max(
        document.documentElement?.scrollHeight || 0,
        document.body?.scrollHeight || 0,
        window.innerHeight || 0
      ))
    }))()`,
  );
  return {
    width: numberOrDefault(result?.width, 0),
    height: numberOrDefault(result?.height, 0),
  };
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function removeStaleTempFiles(dir: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.includes(".tmp-")) continue;
    try {
      fs.rmSync(path.join(dir, entry), { force: true });
    } catch {
      // Temp cleanup should not block rendering.
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
