import { z } from "zod";
import type { TerminalType } from "../types/index.ts";

// --- Sub-schemas ---

export const cliCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
});

export const TERMINAL_TYPES: readonly string[] = [
  "shell",
  "claude",
  "codex",
  "kimi",
  "gemini",
  "opencode",
  "lazygit",
  "tmux",
] as const;

export const cliCommandsSchema = z
  .unknown()
  .transform((raw) => {
    if (typeof raw !== "object" || raw === null) return {};
    const filtered: Record<string, z.infer<typeof cliCommandSchema>> = {};
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      if (!(TERMINAL_TYPES as readonly string[]).includes(key)) continue;
      const result = cliCommandSchema.safeParse(val);
      if (result.success) filtered[key] = result.data;
    }
    return filtered as Partial<Record<TerminalType, z.infer<typeof cliCommandSchema>>>;
  })
  .default({});

export const agentConfigSchema = z.preprocess(
  (v) => (v === undefined || v === null ? {} : v),
  z.object({
    id: z.string().min(1).default("anthropic"),
    name: z.string().min(1).default("Anthropic"),
    type: z.enum(["anthropic", "openai"]).default("anthropic"),
    baseURL: z.string().default(""),
    apiKey: z.string().default(""),
    model: z.string().default(""),
  }),
);

// --- Legacy animationBlur transform ---
// Old format stored true/false instead of a number.
const animationBlurSchema = z.preprocess(
  (v) => {
    if (v === true) return 1.5;
    if (v === false) return 0;
    return v;
  },
  z.number().min(0).max(3).default(0),
);

// --- Main schema ---

export const preferencesSchema = z.object({
  animationBlur: animationBlurSchema,
  terminalFontSize: z.number().min(6).max(24).default(13),
  terminalFontFamily: z.string().min(1).default("geist-mono"),
  composerEnabled: z.boolean().default(false),
  drawingEnabled: z.boolean().default(false),
  browserEnabled: z.boolean().default(false),
  summaryEnabled: z.boolean().default(false),
  summaryCli: z.enum(["claude", "codex"]).default("claude"),
  minimumContrastRatio: z.number().min(1).max(7).default(1),
  cliCommands: cliCommandsSchema,
  agentConfig: agentConfigSchema,
});

export type PersistedPreferences = z.infer<typeof preferencesSchema>;
