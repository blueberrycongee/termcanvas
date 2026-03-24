import fs from "fs";
import path from "path";
import os from "os";

const isDev = !!process.env.VITE_DEV_SERVER_URL;
export const TERMCANVAS_DIR = path.join(
  os.homedir(),
  isDev ? ".termcanvas-dev" : ".termcanvas",
);
const STATE_FILE = path.join(TERMCANVAS_DIR, "state.json");

export class StatePersistence {
  constructor() {
    if (!fs.existsSync(TERMCANVAS_DIR)) {
      fs.mkdirSync(TERMCANVAS_DIR, { recursive: true });
    }
  }

  load(): unknown | null {
    try {
      if (!fs.existsSync(STATE_FILE)) return null;
      const data = fs.readFileSync(STATE_FILE, "utf-8");
      return JSON.parse(data);
    } catch (err) {
      console.error("[StatePersistence] failed to load state:", err);
      return null;
    }
  }

  save(state: unknown) {
    const serialized =
      typeof state === "string" ? state : JSON.stringify(state, null, 2);
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, serialized, "utf-8");
    fs.renameSync(tmp, STATE_FILE);
  }
}
