import fs from "fs";
import path from "path";
import os from "os";

const isDev = !!process.env.VITE_DEV_SERVER_URL;
export const TERMCANVAS_DIR = path.join(
  os.homedir(),
  isDev ? ".termcanvas-dev" : ".termcanvas",
);
const STATE_FILE = path.join(TERMCANVAS_DIR, "state.json");
const PREFERENCES_FILE = path.join(TERMCANVAS_DIR, "preferences.json");

function ensureDir(): void {
  if (!fs.existsSync(TERMCANVAS_DIR)) {
    fs.mkdirSync(TERMCANVAS_DIR, { recursive: true });
  }
}

function loadJsonFile(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error(`[Persistence] failed to load ${filePath}:`, err);
    return null;
  }
}

function saveJsonFile(filePath: string, data: unknown): void {
  ensureDir();
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

export class StatePersistence {
  constructor() {
    ensureDir();
  }

  load(): unknown | null {
    return loadJsonFile(STATE_FILE);
  }

  save(state: unknown): void {
    saveJsonFile(STATE_FILE, state);
  }
}

export class PreferencesPersistence {
  load(): unknown | null {
    return loadJsonFile(PREFERENCES_FILE);
  }

  save(prefs: unknown): void {
    saveJsonFile(PREFERENCES_FILE, prefs);
  }
}
