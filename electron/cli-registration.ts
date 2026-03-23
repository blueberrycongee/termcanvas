import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { ensureCliLauncher } from "./cli-launchers.ts";

const CLI_NAMES = ["termcanvas", "hydra"] as const;
const WINDOWS_PATH_KEY = "HKCU\\Environment";
const WINDOWS_PATH_VALUE = "Path";

export interface WindowsRegistryPathValue {
  type: string;
  value: string;
}

export interface CliRegistrationDeps {
  platform: NodeJS.Platform;
  homedir: () => string;
  chmodSync: (filePath: string, mode: number) => void;
  readFileSync: (filePath: string, encoding: BufferEncoding) => string;
  writeFileSync: (
    filePath: string,
    data: string,
    encoding: BufferEncoding,
  ) => void;
  accessSync: (filePath: string, mode?: number) => void;
  mkdirSync: (dirPath: string, options?: fs.MakeDirectoryOptions) => string | undefined;
  unlinkSync: (filePath: string) => void;
  symlinkSync: (
    target: string,
    path: string,
    type?: fs.symlink.Type | null,
  ) => void;
  lstatSync: (path: string) => fs.Stats;
  ensureCliLauncher: (
    jsPath: string,
    platform?: NodeJS.Platform,
  ) => void;
  readWindowsUserPath: () => WindowsRegistryPathValue | null;
  writeWindowsUserPath: (value: string, type: string) => void;
  deleteWindowsUserPath: () => void;
  broadcastEnvironmentChange: () => void;
}

const defaultDeps: CliRegistrationDeps = {
  platform: process.platform,
  homedir: () => os.homedir(),
  chmodSync: (filePath, mode) => fs.chmodSync(filePath, mode),
  readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
  writeFileSync: (filePath, data, encoding) =>
    fs.writeFileSync(filePath, data, encoding),
  accessSync: (filePath, mode) => fs.accessSync(filePath, mode),
  mkdirSync: (dirPath, options) => fs.mkdirSync(dirPath, options),
  unlinkSync: (filePath) => fs.unlinkSync(filePath),
  symlinkSync: (target, linkPath, type) => fs.symlinkSync(target, linkPath, type),
  lstatSync: (filePath) => fs.lstatSync(filePath),
  ensureCliLauncher,
  readWindowsUserPath: () => readWindowsUserPathFromRegistry(),
  writeWindowsUserPath: (value, type) => writeWindowsUserPathToRegistry(value, type),
  deleteWindowsUserPath: () => deleteWindowsUserPathFromRegistry(),
  broadcastEnvironmentChange: () => broadcastWindowsEnvironmentChange(),
};

function resolveDeps(overrides: Partial<CliRegistrationDeps> = {}): CliRegistrationDeps {
  return { ...defaultDeps, ...overrides };
}

function getPathExportLine(cliDir: string): string {
  return `export PATH="$PATH:${cliDir}"`;
}

function parseWindowsRegistryPathValue(
  output: string,
): WindowsRegistryPathValue | null {
  const line = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => /^Path\s+/i.test(entry));
  if (!line) return null;

  const match = line.match(/^Path\s+(\S+)\s*(.*)$/i);
  if (!match) return null;

  return {
    type: match[1],
    value: match[2] ?? "",
  };
}

function readWindowsUserPathFromRegistry(): WindowsRegistryPathValue | null {
  try {
    const output = execFileSync(
      "reg",
      ["query", WINDOWS_PATH_KEY, "/v", WINDOWS_PATH_VALUE],
      { encoding: "utf-8" },
    );
    return parseWindowsRegistryPathValue(output);
  } catch {
    return null;
  }
}

function writeWindowsUserPathToRegistry(value: string, type: string): void {
  execFileSync(
    "reg",
    [
      "add",
      WINDOWS_PATH_KEY,
      "/v",
      WINDOWS_PATH_VALUE,
      "/t",
      type,
      "/d",
      value,
      "/f",
    ],
    { stdio: "ignore" },
  );
}

function deleteWindowsUserPathFromRegistry(): void {
  execFileSync(
    "reg",
    ["delete", WINDOWS_PATH_KEY, "/v", WINDOWS_PATH_VALUE, "/f"],
    { stdio: "ignore" },
  );
}

function broadcastWindowsEnvironmentChange(): void {
  const script = [
    "Add-Type -Namespace TermCanvas -Name NativeMethods -MemberDefinition @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class NativeMethods {",
    "  [DllImport(\"user32.dll\", SetLastError = true, CharSet = CharSet.Auto)]",
    "  public static extern IntPtr SendMessageTimeout(",
    "    IntPtr hWnd,",
    "    uint Msg,",
    "    UIntPtr wParam,",
    "    string lParam,",
    "    uint fuFlags,",
    "    uint uTimeout,",
    "    out UIntPtr lpdwResult",
    "  );",
    "}",
    "\"@",
    "[UIntPtr]$result = [UIntPtr]::Zero",
    "[void][TermCanvas.NativeMethods]::SendMessageTimeout(",
    "  [IntPtr]0xffff,",
    "  0x001A,",
    "  [UIntPtr]::Zero,",
    "  \"Environment\",",
    "  0x0002,",
    "  5000,",
    "  [ref]$result",
    ")",
  ].join("\n");

  try {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { stdio: "ignore" },
    );
  } catch {
    // Best-effort only. Registry writes are still the source of truth.
  }
}

export function normalizeWindowsPathForComparison(entry: string): string {
  const unquoted = entry.trim().replace(/^"(.*)"$/, "$1");
  if (!unquoted) return "";

  const normalized = path.win32.normalize(unquoted);
  const root = path.win32.parse(normalized).root;
  const trimmed = normalized === root
    ? normalized
    : normalized.replace(/[\\/]+$/, "");
  return trimmed.toLowerCase();
}

function splitPathEntries(pathValue: string | null | undefined): string[] {
  if (!pathValue) return [];
  return pathValue
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function hasWindowsPathEntry(
  pathValue: string | null | undefined,
  targetDir: string,
): boolean {
  const normalizedTarget = normalizeWindowsPathForComparison(targetDir);
  if (!normalizedTarget) return false;

  return splitPathEntries(pathValue).some((entry) =>
    normalizeWindowsPathForComparison(entry) === normalizedTarget
  );
}

export function addWindowsPathEntry(
  pathValue: string | null | undefined,
  targetDir: string,
): string {
  const entries = splitPathEntries(pathValue);
  if (!hasWindowsPathEntry(pathValue, targetDir)) {
    entries.push(targetDir);
  }
  return entries.join(";");
}

export function removeWindowsPathEntry(
  pathValue: string | null | undefined,
  targetDir: string,
): string | null {
  const normalizedTarget = normalizeWindowsPathForComparison(targetDir);
  const filtered = splitPathEntries(pathValue).filter((entry) =>
    normalizeWindowsPathForComparison(entry) !== normalizedTarget
  );
  return filtered.length > 0 ? filtered.join(";") : null;
}

function ensureCliArtifacts(
  cliDir: string,
  deps: CliRegistrationDeps,
): void {
  for (const name of CLI_NAMES) {
    const jsFile = deps.platform === "win32"
      ? path.win32.join(cliDir, `${name}.js`)
      : path.join(cliDir, `${name}.js`);
    try {
      deps.chmodSync(jsFile, 0o755);
    } catch {
      // Packaged apps may live in read-only locations.
    }

    try {
      deps.ensureCliLauncher(jsFile, deps.platform);
    } catch {
      // Best-effort only for generated launchers.
    }
  }
}

export function isCliRegistered(
  cliDir: string,
  overrides: Partial<CliRegistrationDeps> = {},
): boolean {
  const deps = resolveDeps(overrides);

  if (deps.platform === "darwin") {
    const zprofilePath = path.join(deps.homedir(), ".zprofile");
    try {
      const content = deps.readFileSync(zprofilePath, "utf-8");
      return content.includes(getPathExportLine(cliDir));
    } catch {
      return false;
    }
  }

  if (deps.platform === "linux") {
    const target = path.join(deps.homedir(), ".local", "bin", "termcanvas");
    try {
      deps.lstatSync(target);
      return true;
    } catch {
      return false;
    }
  }

  if (deps.platform === "win32") {
    const registryValue = deps.readWindowsUserPath();
    return hasWindowsPathEntry(registryValue?.value, cliDir);
  }

  return false;
}

export function registerCli(
  cliDir: string,
  overrides: Partial<CliRegistrationDeps> = {},
): boolean {
  const deps = resolveDeps(overrides);
  ensureCliArtifacts(cliDir, deps);

  if (deps.platform === "darwin") {
    const zprofilePath = path.join(deps.homedir(), ".zprofile");
    const line = getPathExportLine(cliDir);
    try {
      let content = "";
      try {
        content = deps.readFileSync(zprofilePath, "utf-8");
      } catch {
        // File does not exist yet.
      }

      if (content.includes(line)) {
        return true;
      }

      const newContent = content.endsWith("\n") || content === ""
        ? `${content}${line}\n`
        : `${content}\n${line}\n`;
      deps.writeFileSync(zprofilePath, newContent, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  if (deps.platform === "linux") {
    const binDir = "/usr/local/bin";
    const fallbackDir = path.join(deps.homedir(), ".local", "bin");
    let targetDir = binDir;

    try {
      deps.accessSync(binDir, fs.constants.W_OK);
    } catch {
      targetDir = fallbackDir;
      deps.mkdirSync(targetDir, { recursive: true });
    }

    try {
      for (const name of CLI_NAMES) {
        const target = path.join(targetDir, name);
        const source = path.join(cliDir, `${name}.js`);
        try {
          deps.unlinkSync(target);
        } catch {
          // Ignore missing stale links.
        }
        deps.symlinkSync(source, target);
      }
      return true;
    } catch {
      return false;
    }
  }

  if (deps.platform === "win32") {
    try {
      const current = deps.readWindowsUserPath();
      const nextValue = addWindowsPathEntry(current?.value, cliDir);
      if (current?.value !== nextValue) {
        deps.writeWindowsUserPath(nextValue, current?.type ?? "REG_EXPAND_SZ");
      }
      deps.broadcastEnvironmentChange();
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export function unregisterCli(
  cliDir: string,
  overrides: Partial<CliRegistrationDeps> = {},
): boolean {
  const deps = resolveDeps(overrides);

  if (deps.platform === "darwin") {
    const zprofilePath = path.join(deps.homedir(), ".zprofile");
    const line = getPathExportLine(cliDir);
    try {
      const content = deps.readFileSync(zprofilePath, "utf-8");
      if (!content.includes(line)) return true;
      const newContent = content
        .split("\n")
        .filter((entry) => entry !== line)
        .join("\n");
      deps.writeFileSync(zprofilePath, newContent, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  if (deps.platform === "linux") {
    const dirs = ["/usr/local/bin", path.join(deps.homedir(), ".local", "bin")];
    for (const dir of dirs) {
      for (const name of CLI_NAMES) {
        try {
          deps.unlinkSync(path.join(dir, name));
        } catch {
          // Ignore missing links.
        }
      }
    }
    return true;
  }

  if (deps.platform === "win32") {
    try {
      const current = deps.readWindowsUserPath();
      const nextValue = removeWindowsPathEntry(current?.value, cliDir);

      if (nextValue === null) {
        if (current) {
          deps.deleteWindowsUserPath();
        }
      } else if (current?.value !== nextValue) {
        deps.writeWindowsUserPath(nextValue, current?.type ?? "REG_EXPAND_SZ");
      }

      deps.broadcastEnvironmentChange();
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
