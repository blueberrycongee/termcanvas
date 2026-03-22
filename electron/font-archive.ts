import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function escapePowerShellLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function findFileRecursive(rootDir: string, fileName: string): string | null {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFileRecursive(entryPath, fileName);
      if (nested) return nested;
      continue;
    }
    if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
  }

  return null;
}

function extractFileFromZipWindows(zipPath: string, fileName: string, destinationDir: string): string {
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-font-"));

  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${escapePowerShellLiteral(zipPath)}' -DestinationPath '${escapePowerShellLiteral(extractDir)}' -Force`,
      ],
      { stdio: "pipe" },
    );

    const extractedFile = findFileRecursive(extractDir, fileName);
    if (!extractedFile) {
      throw new Error(`Font file "${fileName}" not found in archive`);
    }

    const destPath = path.join(destinationDir, fileName);
    fs.copyFileSync(extractedFile, destPath);
    return destPath;
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

function extractFileFromZipUnix(zipPath: string, fileName: string, destinationDir: string): string {
  const zipList = execSync(`unzip -l "${zipPath}"`, {
    encoding: "utf-8",
  });
  const lines = zipList.split("\n");
  const matchLine = lines.find((line) => line.trim().endsWith(fileName));
  if (!matchLine) {
    throw new Error(`Font file "${fileName}" not found in archive`);
  }

  const innerPath = matchLine.trim().split(/\s+/).pop()!;

  execSync(
    `unzip -jo "${zipPath}" "${innerPath}" -d "${destinationDir}"`,
    { encoding: "utf-8" },
  );

  return path.join(destinationDir, fileName);
}

export function extractFileFromZip(
  zipPath: string,
  fileName: string,
  destinationDir: string,
): string {
  if (process.platform === "win32") {
    return extractFileFromZipWindows(zipPath, fileName, destinationDir);
  }

  return extractFileFromZipUnix(zipPath, fileName, destinationDir);
}
