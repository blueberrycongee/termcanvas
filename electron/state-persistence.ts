import fs from "fs";
import path from "path";
import os from "os";

export const TERMCANVAS_DIR = path.join(os.homedir(), ".termcanvas");
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
    } catch {
      return null;
    }
  }

  save(state: unknown) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  }
}
