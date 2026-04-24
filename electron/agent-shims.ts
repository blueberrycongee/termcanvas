import fs from "fs";
import path from "path";

export function getAgentShimDir(cliDir: string): string {
  return path.join(cliDir, "agent-shims");
}

export function getTerminalExtraPathEntries(
  cliDir: string,
  terminalType: string | undefined,
  existsSync: (file: string) => boolean = fs.existsSync,
): string[] {
  const entries = [cliDir];
  if (terminalType === "shell") {
    const shimDir = getAgentShimDir(cliDir);
    if (existsSync(shimDir)) {
      entries.push(shimDir);
    }
  }
  return entries;
}
