import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CaptureMode = "som" | "vision" | "ax";

export interface ComputerUseConfig {
  schema_version: 1;
  capture_mode: CaptureMode;
  max_image_dimension: number;
}

const DEFAULT_CONFIG: ComputerUseConfig = {
  schema_version: 1,
  capture_mode: "som",
  max_image_dimension: 1568,
};

function configFilePath(): string {
  const configured = process.env.TERMCANVAS_COMPUTER_USE_CONFIG?.trim();
  if (configured) return configured;
  return path.join(os.homedir(), ".termcanvas", "computer-use", "config.json");
}

function normalizeCaptureMode(value: unknown): CaptureMode | null {
  if (value === "som" || value === "vision" || value === "ax") return value;
  if (value === "screenshot") return "vision";
  return null;
}

function normalizeConfig(raw: Record<string, unknown>): ComputerUseConfig {
  const captureMode = normalizeCaptureMode(raw.capture_mode) ?? DEFAULT_CONFIG.capture_mode;
  const maxImageDimension =
    typeof raw.max_image_dimension === "number" &&
    Number.isInteger(raw.max_image_dimension) &&
    raw.max_image_dimension >= 0
      ? raw.max_image_dimension
      : DEFAULT_CONFIG.max_image_dimension;
  return {
    schema_version: 1,
    capture_mode: captureMode,
    max_image_dimension: maxImageDimension,
  };
}

function readPatchCaptureMode(value: unknown): CaptureMode {
  const mode = normalizeCaptureMode(value);
  if (!mode) {
    throw new Error("capture_mode must be one of: som, vision, ax.");
  }
  return mode;
}

function readPatchMaxImageDimension(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error("max_image_dimension must be a non-negative integer.");
  }
  return value;
}

export function readComputerUseConfig(): ComputerUseConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configFilePath(), "utf-8")) as unknown;
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      return normalizeConfig(raw as Record<string, unknown>);
    }
  } catch {
    // Missing config is the normal first-run state.
  }
  return DEFAULT_CONFIG;
}

export function updateComputerUseConfig(
  patch: Record<string, unknown>,
): ComputerUseConfig {
  const current = readComputerUseConfig();
  const next: ComputerUseConfig = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "capture_mode") {
      next.capture_mode = readPatchCaptureMode(value);
    } else if (key === "max_image_dimension") {
      next.max_image_dimension = readPatchMaxImageDimension(value);
    } else if (key === "schema_version") {
      continue;
    } else {
      throw new Error(
        `Unknown config key: ${key}. Supported keys: capture_mode, max_image_dimension.`,
      );
    }
  }
  const filePath = configFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, filePath);
  return next;
}
