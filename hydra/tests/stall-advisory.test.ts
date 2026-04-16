import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStallAdvisory, type StallAdvisoryInput } from "../src/stall-advisory.ts";
import type { ProgressProbeResult } from "../src/terminal-liveness.ts";

const THRESHOLDS = {
  claude: 135_000, // 3× default Claude stall
  codex: 540_000, // 3× default Codex stall
  default: 135_000,
};

function stalledSnapshot(offsetMs: number, nowIso: string): ProgressProbeResult {
  const progressAt = new Date(Date.parse(nowIso) - offsetMs).toISOString();
  return {
    available: true,
    snapshot: {
      derived_status: "stall_candidate",
      last_meaningful_progress_at: progressAt,
    },
  };
}

test("evaluateStallAdvisory fires when every dispatch is stalled past its threshold", () => {
  const now = "2026-04-16T12:00:00.000Z";
  const dispatches: StallAdvisoryInput[] = [
    { dispatchId: "d1", role: "dev", agentType: "claude", terminalId: "t1" },
    { dispatchId: "d2", role: "reviewer", agentType: "codex", terminalId: "t2" },
  ];
  const probes: Record<string, ProgressProbeResult> = {
    // Claude: stalled 200s (> 135s advisory threshold)
    t1: stalledSnapshot(200_000, now),
    // Codex: stalled 600s (> 540s advisory threshold)
    t2: stalledSnapshot(600_000, now),
  };

  const advisory = evaluateStallAdvisory(dispatches, {
    now: () => now,
    probe: (id) => probes[id],
    thresholdsMs: THRESHOLDS,
  });

  assert.ok(advisory, "expected advisory to fire");
  assert.equal(advisory.telemetry_available, true);
  assert.equal(advisory.dispatches.length, 2);
  assert.equal(advisory.dispatches[0].dispatch_id, "d1");
  assert.equal(advisory.dispatches[0].advisory_threshold_ms, THRESHOLDS.claude);
  assert.equal(advisory.dispatches[1].advisory_threshold_ms, THRESHOLDS.codex);
  assert.ok(advisory.dispatches[0].stalled_for_ms! >= THRESHOLDS.claude);
  assert.ok(advisory.dispatches[1].stalled_for_ms! >= THRESHOLDS.codex);
});

test("evaluateStallAdvisory does NOT fire when one dispatch is still progressing", () => {
  // Mixed batch: one truly stalled, one still working. Interrupting the
  // Lead in this case would be noise — the progressing dispatch may
  // produce a real DecisionPoint on the next tick and the Lead can wait.
  const now = "2026-04-16T12:00:00.000Z";
  const dispatches: StallAdvisoryInput[] = [
    { dispatchId: "d1", role: "dev", agentType: "claude", terminalId: "t1" },
    { dispatchId: "d2", role: "reviewer", agentType: "claude", terminalId: "t2" },
  ];
  const probes: Record<string, ProgressProbeResult> = {
    t1: stalledSnapshot(200_000, now),
    t2: {
      available: true,
      snapshot: {
        derived_status: "progressing",
        last_meaningful_progress_at: new Date(Date.parse(now) - 5_000).toISOString(),
      },
    },
  };

  const advisory = evaluateStallAdvisory(dispatches, {
    now: () => now,
    probe: (id) => probes[id],
    thresholdsMs: THRESHOLDS,
  });

  assert.equal(advisory, null);
});

test("evaluateStallAdvisory does NOT fire when telemetry is unreachable for any dispatch", () => {
  // Unknown is not stalled. If telemetry is down we cannot confirm the
  // stall, so bailing preserves the invariant that advisories are only
  // emitted on strong signal.
  const now = "2026-04-16T12:00:00.000Z";
  const dispatches: StallAdvisoryInput[] = [
    { dispatchId: "d1", role: "dev", agentType: "claude", terminalId: "t1" },
  ];
  const advisory = evaluateStallAdvisory(dispatches, {
    now: () => now,
    probe: () => ({ available: false, snapshot: null }),
    thresholdsMs: THRESHOLDS,
  });

  assert.equal(advisory, null);
});

test("evaluateStallAdvisory does NOT fire when stalled duration is below threshold", () => {
  // 45 s is enough to trip the UI stall indicator but not the 3× advisory
  // threshold. This guards against promoting the UI signal to a control
  // signal, which would produce false positives on long tool calls.
  const now = "2026-04-16T12:00:00.000Z";
  const dispatches: StallAdvisoryInput[] = [
    { dispatchId: "d1", role: "dev", agentType: "claude", terminalId: "t1" },
  ];
  const advisory = evaluateStallAdvisory(dispatches, {
    now: () => now,
    probe: () => stalledSnapshot(60_000, now),
    thresholdsMs: THRESHOLDS,
  });

  assert.equal(advisory, null);
});

test("evaluateStallAdvisory accepts awaiting_contract as a stall state", () => {
  // awaiting_contract means the agent is done doing work but has not
  // written result.json — a classic "forgot the contract" stall that
  // Lead should learn about so it can reset with clarifying feedback.
  const now = "2026-04-16T12:00:00.000Z";
  const dispatches: StallAdvisoryInput[] = [
    { dispatchId: "d1", role: "dev", agentType: "claude", terminalId: "t1" },
  ];
  const advisory = evaluateStallAdvisory(dispatches, {
    now: () => now,
    probe: () => ({
      available: true,
      snapshot: {
        derived_status: "awaiting_contract",
        last_meaningful_progress_at: new Date(Date.parse(now) - 200_000).toISOString(),
      },
    }),
    thresholdsMs: THRESHOLDS,
  });

  assert.ok(advisory);
  assert.equal(advisory.dispatches[0].derived_status, "awaiting_contract");
});

test("evaluateStallAdvisory does NOT fire when derived_status is idle", () => {
  // "idle" means the agent is between turns by design, not that it is
  // stuck. Lead has no action to take — skip.
  const now = "2026-04-16T12:00:00.000Z";
  const dispatches: StallAdvisoryInput[] = [
    { dispatchId: "d1", role: "dev", agentType: "claude", terminalId: "t1" },
  ];
  const advisory = evaluateStallAdvisory(dispatches, {
    now: () => now,
    probe: () => ({
      available: true,
      snapshot: {
        derived_status: "idle",
        last_meaningful_progress_at: new Date(Date.parse(now) - 500_000).toISOString(),
      },
    }),
    thresholdsMs: THRESHOLDS,
  });

  assert.equal(advisory, null);
});

test("evaluateStallAdvisory returns null on empty input", () => {
  const advisory = evaluateStallAdvisory([], { now: () => new Date().toISOString() });
  assert.equal(advisory, null);
});

test("evaluateStallAdvisory requires last_meaningful_progress_at to confirm duration", () => {
  const now = "2026-04-16T12:00:00.000Z";
  const dispatches: StallAdvisoryInput[] = [
    { dispatchId: "d1", role: "dev", agentType: "claude", terminalId: "t1" },
  ];
  const advisory = evaluateStallAdvisory(dispatches, {
    now: () => now,
    probe: () => ({
      available: true,
      snapshot: {
        derived_status: "stall_candidate",
        // No last_meaningful_progress_at — cannot measure stall duration.
      },
    }),
    thresholdsMs: THRESHOLDS,
  });

  assert.equal(advisory, null);
});
