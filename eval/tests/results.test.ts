import { describe, it } from "node:test";
import { strict as a } from "node:assert";
import { computeSummary, generateRunId } from "../src/results.ts";
import type { TaskResult } from "../src/types.ts";

describe("computeSummary", () => {
  it("computes correct summary for mixed results", () => {
    const tasks: TaskResult[] = [
      { task_id: "t1", pass: true, model_patch: "p", tokens: 10000, duration_s: 100, cost_usd: 0.5 },
      { task_id: "t2", pass: false, model_patch: "", tokens: 5000, duration_s: 50, cost_usd: 0.2, error: "timeout" },
      { task_id: "t3", pass: true, model_patch: "p", tokens: 15000, duration_s: 200, cost_usd: 0.8 },
    ];

    const summary = computeSummary(tasks);
    a.equal(summary.total, 3);
    a.equal(summary.resolved, 2);
    a.ok(Math.abs(summary.pass_rate - 2 / 3) < 0.001);
    a.equal(summary.total_tokens, 30000);
    a.equal(summary.total_cost_usd, 1.5);
    a.ok(Math.abs(summary.avg_duration_s - 117) < 1);
  });

  it("handles empty task list", () => {
    const summary = computeSummary([]);
    a.equal(summary.total, 0);
    a.equal(summary.resolved, 0);
    a.equal(summary.pass_rate, 0);
    a.equal(summary.total_tokens, 0);
    a.equal(summary.total_cost_usd, 0);
    a.equal(summary.avg_duration_s, 0);
  });
});

describe("generateRunId", () => {
  it("generates unique IDs", () => {
    const id1 = generateRunId();
    const id2 = generateRunId();
    a.notEqual(id1, id2);
    a.ok(id1.startsWith("run-"));
  });

  it("includes date and time components", () => {
    const id = generateRunId();
    // Format: run-YYYYMMDD-HHMMSS-xxxx
    const parts = id.split("-");
    a.equal(parts[0], "run");
    a.equal(parts[1].length, 8); // YYYYMMDD
    a.equal(parts[2].length, 6); // HHMMSS
    a.equal(parts[3].length, 4); // random suffix
  });
});
