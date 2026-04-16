import {
  DEFAULT_CLAUDE_STALL_ADVISORY_MS,
  DEFAULT_CODEX_STALL_ADVISORY_MS,
} from "../../shared/lifecycleThresholds.ts";
import type { StallAdvisoryInfo } from "./decision.ts";
import {
  probeTerminalProgress,
  type ProgressProbeResult,
} from "./terminal-liveness.ts";

/**
 * Stall-advisory evaluation for the hydra watch loop.
 *
 * An advisory is a soft signal: "every dispatch we are watching has stopped
 * making meaningful progress for long enough that the Lead should check in".
 * Hydra never autonomously kills or retries workers on this signal — the UI
 * threshold that drives derived_status is deliberately aggressive (45 s for
 * Claude, 180 s for Codex) and would produce a deluge of false positives if
 * it controlled workflow. The advisory threshold is a 3× multiplier on top
 * of the UI threshold, so by the time we fire the Lead has strong signal
 * that the worker is not just in a long tool call.
 *
 * Conservative firing rules:
 *   - Every dispatch in the batch must be stalled. A single progressing
 *     dispatch means other work is happening; do not interrupt the Lead.
 *   - Telemetry must be reachable for every dispatch. "Unknown" is not
 *     "stalled" — if the app is down or a probe flaked, return null so
 *     the watch loop keeps polling rather than interrupt Lead on noise.
 *   - derived_status must be in an explicitly stalled state (stall_candidate
 *     or awaiting_contract). "idle" is not a stall for our purposes —
 *     agents between turns are idle-by-design. "starting"/"progressing"
 *     are active. Anything else (error, exited, unknown) is handled by the
 *     fix-1 PTY-liveness / contract-collection paths, not here.
 *   - last_meaningful_progress_at must be present and older than the
 *     per-agent advisory threshold. Missing timestamps cannot confirm
 *     duration, so we bail to null rather than guess.
 */

export interface StallAdvisoryInput {
  dispatchId: string;
  role: string;
  agentType: string;
  terminalId: string;
}

export interface EvaluateStallAdvisoryDependencies {
  probe?: (terminalId: string) => ProgressProbeResult;
  now?: () => string;
  /** Override the per-agent advisory threshold map (tests). */
  thresholdsMs?: {
    claude: number;
    codex: number;
    /** Used for kimi/gemini/other; defaults to the claude threshold. */
    default: number;
  };
}

const STALL_STATES = new Set<string>(["stall_candidate", "awaiting_contract"]);

function thresholdFor(
  agentType: string,
  overrides?: EvaluateStallAdvisoryDependencies["thresholdsMs"],
): number {
  if (overrides) {
    if (agentType === "codex") return overrides.codex;
    if (agentType === "claude") return overrides.claude;
    return overrides.default;
  }
  if (agentType === "codex") return DEFAULT_CODEX_STALL_ADVISORY_MS;
  // Claude and every other CLI (kimi, gemini) share the same threshold for
  // now — telemetry does not yet distinguish their stall profiles.
  return DEFAULT_CLAUDE_STALL_ADVISORY_MS;
}

export function evaluateStallAdvisory(
  dispatches: StallAdvisoryInput[],
  dependencies: EvaluateStallAdvisoryDependencies = {},
): StallAdvisoryInfo | null {
  if (dispatches.length === 0) return null;

  const now = dependencies.now ?? (() => new Date().toISOString());
  const probe = dependencies.probe ?? ((id: string) => probeTerminalProgress(id));

  const nowMs = Date.parse(now());
  if (Number.isNaN(nowMs)) return null;

  const entries: StallAdvisoryInfo["dispatches"] = [];

  for (const dispatch of dispatches) {
    const threshold = thresholdFor(dispatch.agentType, dependencies.thresholdsMs);
    const result = probe(dispatch.terminalId);

    // Telemetry unreachable or snapshot missing — cannot confirm stall.
    if (!result.available || !result.snapshot) return null;

    const snapshot = result.snapshot;
    const derivedStatus = snapshot.derived_status;

    // Must be in an explicitly stalled state.
    if (!derivedStatus || !STALL_STATES.has(derivedStatus)) return null;

    // Need a concrete timestamp to measure duration.
    const lastProgress = snapshot.last_meaningful_progress_at;
    if (!lastProgress) return null;

    const lastProgressMs = Date.parse(lastProgress);
    if (Number.isNaN(lastProgressMs)) return null;

    const stalledForMs = nowMs - lastProgressMs;
    if (stalledForMs < threshold) return null;

    entries.push({
      dispatch_id: dispatch.dispatchId,
      role: dispatch.role,
      agent_type: dispatch.agentType,
      derived_status: derivedStatus,
      last_meaningful_progress_at: lastProgress,
      stalled_for_ms: stalledForMs,
      advisory_threshold_ms: threshold,
    });
  }

  // Advisory is only emitted when EVERY dispatch confirmed stalled above
  // threshold — guaranteed by the early-return pattern above.
  return {
    dispatches: entries,
    telemetry_available: true,
  };
}
