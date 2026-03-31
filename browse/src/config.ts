import path from "node:path";
import os from "node:os";

export const BROWSE_DIR = path.join(os.homedir(), ".termcanvas", "browse");
export const STATE_FILE = path.join(BROWSE_DIR, "browse.json");
export const DEFAULT_PORT = 0; // auto-assign
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export interface ServerState {
  port: number;
  token: string;
  pid: number;
}
