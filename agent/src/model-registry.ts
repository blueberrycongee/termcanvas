/**
 * Static model capability registry — synchronous lookup, no runtime IO.
 *
 * Maps model IDs to capabilities: context window, max output tokens,
 * tool support, thinking support, pricing, and provider family.
 */

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

export interface ModelCapability {
  id: string;
  displayName: string;
  providerFamily: "anthropic" | "openai";
  contextWindow: number;
  maxOutputTokens: number;
  supportsToolUse: boolean;
  supportsThinking: boolean;
  systemRoleName: "system" | "developer";
  pricing: ModelPricing;
}

const MODELS: ModelCapability[] = [
  {
    id: "claude-opus-4-20250514",
    displayName: "Claude Opus 4",
    providerFamily: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    supportsToolUse: true,
    supportsThinking: true,
    systemRoleName: "system",
    pricing: { inputPerMillion: 15, outputPerMillion: 75, cacheReadPerMillion: 1.5, cacheWritePerMillion: 18.75 },
  },
  {
    id: "claude-sonnet-4-20250514",
    displayName: "Claude Sonnet 4",
    providerFamily: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    supportsToolUse: true,
    supportsThinking: true,
    systemRoleName: "system",
    pricing: { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  },
  {
    id: "claude-sonnet-4-6-20250627",
    displayName: "Claude Sonnet 4.6",
    providerFamily: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    supportsToolUse: true,
    supportsThinking: true,
    systemRoleName: "system",
    pricing: { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
  },
  {
    id: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    providerFamily: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsToolUse: true,
    supportsThinking: true,
    systemRoleName: "system",
    pricing: { inputPerMillion: 0.8, outputPerMillion: 4, cacheReadPerMillion: 0.08, cacheWritePerMillion: 1 },
  },

  {
    id: "gpt-4o",
    displayName: "GPT-4o",
    providerFamily: "openai",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsToolUse: true,
    supportsThinking: false,
    systemRoleName: "system",
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
  },
  {
    id: "gpt-4o-mini",
    displayName: "GPT-4o Mini",
    providerFamily: "openai",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsToolUse: true,
    supportsThinking: false,
    systemRoleName: "system",
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  },
  {
    id: "gpt-4.1",
    displayName: "GPT-4.1",
    providerFamily: "openai",
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    supportsToolUse: true,
    supportsThinking: false,
    systemRoleName: "system",
    pricing: { inputPerMillion: 2, outputPerMillion: 8 },
  },
  {
    id: "gpt-4.1-mini",
    displayName: "GPT-4.1 Mini",
    providerFamily: "openai",
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    supportsToolUse: true,
    supportsThinking: false,
    systemRoleName: "system",
    pricing: { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  },
  {
    id: "gpt-4.1-nano",
    displayName: "GPT-4.1 Nano",
    providerFamily: "openai",
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    supportsToolUse: true,
    supportsThinking: false,
    systemRoleName: "system",
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  },
  {
    id: "o3",
    displayName: "o3",
    providerFamily: "openai",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsToolUse: true,
    supportsThinking: true,
    systemRoleName: "developer",
    pricing: { inputPerMillion: 10, outputPerMillion: 40 },
  },
  {
    id: "o3-mini",
    displayName: "o3 Mini",
    providerFamily: "openai",
    contextWindow: 200_000,
    maxOutputTokens: 65_536,
    supportsToolUse: true,
    supportsThinking: true,
    systemRoleName: "developer",
    pricing: { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  },
  {
    id: "o4-mini",
    displayName: "o4 Mini",
    providerFamily: "openai",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsToolUse: true,
    supportsThinking: true,
    systemRoleName: "developer",
    pricing: { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  },
];

const ALIASES: Record<string, string> = {
  "claude-opus-4-latest": "claude-opus-4-20250514",
  "claude-sonnet-4-latest": "claude-sonnet-4-20250514",
  "claude-sonnet-4-6-latest": "claude-sonnet-4-6-20250627",
  "claude-haiku-4-5-latest": "claude-haiku-4-5-20251001",
};

const O_SERIES = new Set(["o3", "o3-mini", "o4-mini"]);

const registry = new Map<string, ModelCapability>();
for (const model of MODELS) {
  registry.set(model.id, model);
}

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;

export function getModelCapability(modelId: string): ModelCapability | undefined {
  const resolved = ALIASES[modelId] ?? modelId;
  const exact = registry.get(resolved);
  if (exact) return exact;

  let best: ModelCapability | undefined;
  let bestLen = 0;
  for (const [id, cap] of registry) {
    if (resolved.startsWith(id) && id.length > bestLen) {
      best = cap;
      bestLen = id.length;
    }
  }
  return best;
}

export function getModelPricing(modelId: string): ModelPricing | undefined {
  return getModelCapability(modelId)?.pricing;
}

export function isOSeriesModel(modelId: string): boolean {
  const resolved = ALIASES[modelId] ?? modelId;
  if (O_SERIES.has(resolved)) return true;
  for (const prefix of O_SERIES) {
    if (resolved.startsWith(prefix)) return true;
  }
  return false;
}

export function getContextWindow(modelId: string): number {
  return getModelCapability(modelId)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

export function getMaxOutputTokens(modelId: string): number {
  return getModelCapability(modelId)?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
}
