import { execFileSync } from "node:child_process";

function escapePowerShellLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function normalizeWindowsPathEntry(entry: string): string {
  return entry
    .trim()
    .replaceAll("/", "\\")
    .replace(/[\\]+$/, "")
    .toLowerCase();
}

export function splitWindowsPathEntries(pathValue: string): string[] {
  return pathValue
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function hasWindowsPathEntry(pathValue: string, entry: string): boolean {
  const target = normalizeWindowsPathEntry(entry);
  return splitWindowsPathEntries(pathValue).some(
    (candidate) => normalizeWindowsPathEntry(candidate) === target,
  );
}

export function addWindowsPathEntry(pathValue: string, entry: string): string {
  if (hasWindowsPathEntry(pathValue, entry)) return pathValue;
  return pathValue.trim().length > 0 ? `${pathValue};${entry}` : entry;
}

export function removeWindowsPathEntry(pathValue: string, entry: string): string {
  const target = normalizeWindowsPathEntry(entry);
  return splitWindowsPathEntries(pathValue)
    .filter((candidate) => normalizeWindowsPathEntry(candidate) !== target)
    .join(";");
}

export function readWindowsUserPath(): string {
  return execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "[Environment]::GetEnvironmentVariable('Path', 'User')",
    ],
    { encoding: "utf-8" },
  ).trim();
}

export function writeWindowsUserPath(pathValue: string): void {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `[Environment]::SetEnvironmentVariable('Path', '${escapePowerShellLiteral(pathValue)}', 'User')`,
    ],
    { stdio: "pipe" },
  );
}
