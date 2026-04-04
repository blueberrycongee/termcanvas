import fs from "fs";
import path from "path";

import { TERMCANVAS_DIR } from "./state-persistence";

const CLI_INTEGRATION_FILE = path.join(TERMCANVAS_DIR, "cli-integration.json");

interface CliIntegrationState {
  autoRegister: boolean;
}

interface SyncCliIntegrationOnStartupOptions {
  autoRegisterEnabled: boolean;
  cliRegistered: boolean;
  registerCli: () => boolean;
  installSkills: () => boolean;
  ensureSkills: () => boolean;
  persistAutoRegisterEnabled: (enabled: boolean) => void;
}

export function readCliIntegrationState(
  filePath = CLI_INTEGRATION_FILE,
): CliIntegrationState {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<CliIntegrationState>;
    if (typeof raw.autoRegister === "boolean") {
      return { autoRegister: raw.autoRegister };
    }
  } catch {
    // Missing or invalid config falls back to enabled-by-default behavior.
  }

  return { autoRegister: true };
}

export function writeCliIntegrationState(
  state: CliIntegrationState,
  filePath = CLI_INTEGRATION_FILE,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

export function syncCliIntegrationOnStartup({
  autoRegisterEnabled,
  cliRegistered,
  registerCli,
  installSkills,
  ensureSkills,
  persistAutoRegisterEnabled,
}: SyncCliIntegrationOnStartupOptions): void {
  if (!autoRegisterEnabled) {
    return;
  }

  if (cliRegistered) {
    ensureSkills();
    return;
  }

  const registered = registerCli();
  if (!registered) {
    return;
  }

  persistAutoRegisterEnabled(true);
  installSkills();
}
