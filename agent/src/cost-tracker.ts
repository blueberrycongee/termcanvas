/**
 * Per-turn cost calculation and budget enforcement.
 *
 * Uses model pricing from the registry to convert token counts to USD.
 * All state is JSON-serializable for session persistence.
 */

import { getModelPricing } from "./model-registry.ts";
import type { Usage } from "./types.ts";

// ---------------------------------------------------------------------------
// Types (all JSON-safe for serialization)
// ---------------------------------------------------------------------------

export interface TurnCost {
  turn: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUSD: number;
}

export interface CostState {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCostUSD: number;
  turnCosts: TurnCost[];
}

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------

export function calculateTurnCost(usage: Usage, model: string): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;

  const inputCost = (usage.input_tokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost = pricing.cacheReadPerMillion
    ? ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * pricing.cacheReadPerMillion
    : 0;
  const cacheWriteCost = pricing.cacheWritePerMillion
    ? ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * pricing.cacheWritePerMillion
    : 0;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export class CostTracker {
  private state: CostState;
  private model: string;
  private turnCounter: number;

  constructor(model: string, initialState?: CostState) {
    this.model = model;
    this.turnCounter = initialState?.turnCosts.length ?? 0;
    this.state = initialState ?? {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalCostUSD: 0,
      turnCosts: [],
    };
  }

  addUsage(usage: Usage, model?: string): TurnCost {
    const effectiveModel = model ?? this.model;
    const costUSD = calculateTurnCost(usage, effectiveModel);
    this.turnCounter++;

    const turnCost: TurnCost = {
      turn: this.turnCounter,
      model: effectiveModel,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      costUSD,
    };

    this.state.totalInputTokens += turnCost.inputTokens;
    this.state.totalOutputTokens += turnCost.outputTokens;
    this.state.totalCacheReadTokens += turnCost.cacheReadTokens;
    this.state.totalCacheWriteTokens += turnCost.cacheWriteTokens;
    this.state.totalCostUSD += costUSD;
    this.state.turnCosts.push(turnCost);

    return turnCost;
  }

  getTotalCostUSD(): number {
    return this.state.totalCostUSD;
  }

  getState(): CostState {
    return { ...this.state, turnCosts: [...this.state.turnCosts] };
  }

  exceedsBudget(maxBudgetUSD: number): boolean {
    return this.state.totalCostUSD >= maxBudgetUSD;
  }
}
