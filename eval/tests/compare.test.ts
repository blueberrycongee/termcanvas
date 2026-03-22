import { describe, it } from "node:test";
import { strict as a } from "node:assert";
import { compareResults, formatComparison } from "../src/compare.ts";
import type { RunResult } from "../src/types.ts";

function makeResult(overrides: Partial<RunResult>): RunResult {
  return {
    run_id: "test-run",
    config: {
      run_id: "test-run",
      mode: "single-claude",
      prompt_version: "v1",
      benchmark: "swe-bench",
    },
    started_at: "2026-03-22T00:00:00Z",
    completed_at: "2026-03-22T01:00:00Z",
    tasks: [],
    summary: {
      total: 0,
      resolved: 0,
      pass_rate: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      avg_duration_s: 0,
    },
    ...overrides,
  };
}

describe("compareResults", () => {
  it("detects improved and regressed tasks", () => {
    const runA = makeResult({
      run_id: "run-a",
      config: { run_id: "run-a", mode: "single-claude", prompt_version: "v1", benchmark: "swe-bench" },
      tasks: [
        { task_id: "t1", pass: true, model_patch: "", tokens: 100, duration_s: 10, cost_usd: 0.1 },
        { task_id: "t2", pass: false, model_patch: "", tokens: 200, duration_s: 20, cost_usd: 0.2 },
      ],
      summary: { total: 2, resolved: 1, pass_rate: 0.5, total_tokens: 300, total_cost_usd: 0.3, avg_duration_s: 15 },
    });

    const runB = makeResult({
      run_id: "run-b",
      config: { run_id: "run-b", mode: "single-codex", prompt_version: "v1", benchmark: "swe-bench" },
      tasks: [
        { task_id: "t1", pass: false, model_patch: "", tokens: 50, duration_s: 5, cost_usd: 0.05 },
        { task_id: "t2", pass: true, model_patch: "", tokens: 150, duration_s: 15, cost_usd: 0.15 },
      ],
      summary: { total: 2, resolved: 1, pass_rate: 0.5, total_tokens: 200, total_cost_usd: 0.2, avg_duration_s: 10 },
    });

    const comparison = compareResults(runA, runB);

    a.equal(comparison.run_a, "run-a");
    a.equal(comparison.run_b, "run-b");

    const t1 = comparison.task_diffs.find((t) => t.task_id === "t1");
    const t2 = comparison.task_diffs.find((t) => t.task_id === "t2");
    a.equal(t1?.status, "regressed");
    a.equal(t2?.status, "improved");

    a.ok("mode" in comparison.config_diff);
  });

  it("formats comparison as readable report", () => {
    const runA = makeResult({
      run_id: "run-a",
      tasks: [
        { task_id: "t1", pass: true, model_patch: "", tokens: 100, duration_s: 10, cost_usd: 0.1 },
      ],
      summary: { total: 1, resolved: 1, pass_rate: 1, total_tokens: 100, total_cost_usd: 0.1, avg_duration_s: 10 },
    });

    const runB = makeResult({
      run_id: "run-b",
      tasks: [
        { task_id: "t1", pass: false, model_patch: "", tokens: 200, duration_s: 20, cost_usd: 0.2 },
      ],
      summary: { total: 1, resolved: 0, pass_rate: 0, total_tokens: 200, total_cost_usd: 0.2, avg_duration_s: 20 },
    });

    const comparison = compareResults(runA, runB);
    const report = formatComparison(comparison);

    a.ok(report.includes("run-a"));
    a.ok(report.includes("run-b"));
    a.ok(report.includes("Pass Rate"));
    a.ok(report.includes("Regressed"));
  });
});
