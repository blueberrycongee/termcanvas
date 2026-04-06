import fs from "fs";
import path from "path";
import { z } from "zod";
import { getTermCanvasDataDir } from "../shared/termcanvas-instance";

const isDev = !!process.env.VITE_DEV_SERVER_URL;
export const TERMCANVAS_DIR = getTermCanvasDataDir(isDev ? "dev" : "prod");
const STATE_FILE = path.join(TERMCANVAS_DIR, "state.json");
const STATE_ENVELOPE_VERSION = 1;

const stateEnvelopeSchema = z.object({
  version: z.literal(STATE_ENVELOPE_VERSION),
  payload: z.unknown(),
});

type StateEnvelope = z.infer<typeof stateEnvelopeSchema>;

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
      const parsed = JSON.parse(data) as unknown;
      const envelope = stateEnvelopeSchema.safeParse(parsed);
      if (envelope.success) {
        return envelope.data.payload;
      }
      return parsed;
    } catch (err) {
      console.error("[StatePersistence] failed to load state:", err);
      return null;
    }
  }

  save(state: unknown) {
    const serialized = JSON.stringify(
      {
        version: STATE_ENVELOPE_VERSION,
        payload: state,
      } satisfies StateEnvelope,
      null,
      2,
    );
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, serialized, "utf-8");
    fs.renameSync(tmp, STATE_FILE);
  }
}
