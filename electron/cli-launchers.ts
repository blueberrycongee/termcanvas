import fs from "fs";
import path from "path";

export function getCliLauncherPath(
  jsPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const basePath = jsPath.replace(/\.js$/, "");
  return platform === "win32" ? `${basePath}.cmd` : basePath;
}

export function getWindowsCliLauncherContent(jsPath: string): string {
  const fileName = jsPath.split(/[/\\]/).pop() ?? jsPath;
  return `@echo off\r\nnode "%~dp0\\${fileName}" %*\r\n`;
}

export function ensureCliLauncher(
  jsPath: string,
  platform: NodeJS.Platform = process.platform,
): void {
  try {
    fs.chmodSync(jsPath, 0o755);
  } catch {
  }

  const basePath = jsPath.replace(/\.js$/, "");

  if (platform === "win32") {
    try {
      fs.unlinkSync(basePath);
    } catch {
    }
    fs.writeFileSync(
      `${basePath}.cmd`,
      getWindowsCliLauncherContent(jsPath),
      "utf-8",
    );
    return;
  }

  try {
    fs.lstatSync(basePath);
  } catch {
    fs.symlinkSync(path.basename(jsPath), basePath);
  }
}
