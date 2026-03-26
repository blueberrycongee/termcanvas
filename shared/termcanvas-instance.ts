import os from "node:os";
import path from "node:path";

export type TermCanvasInstance = "prod" | "dev";

function normalizeInstance(value: string | undefined): TermCanvasInstance | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "prod" || normalized === "production") return "prod";
  if (normalized === "dev" || normalized === "development") return "dev";
  return null;
}

export function getTermCanvasDataDir(instance: TermCanvasInstance): string {
  return path.join(
    os.homedir(),
    instance === "dev" ? ".termcanvas-dev" : ".termcanvas",
  );
}

export function resolveTermCanvasInstance(
  env: Record<string, string | undefined> = process.env,
): TermCanvasInstance {
  return normalizeInstance(env.TERMCANVAS_INSTANCE) ?? "prod";
}

export function resolveTermCanvasPortFile(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env.TERMCANVAS_PORT_FILE?.trim();
  if (explicit) return explicit;
  return path.join(
    getTermCanvasDataDir(resolveTermCanvasInstance(env)),
    "port",
  );
}
