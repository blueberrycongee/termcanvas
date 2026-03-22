import type {
  RunResult,
  RunComparison,
  TaskDiff,
  EvalConfig,
} from "./types.ts";
import { loadRunResult } from "./results.ts";

/** Compare two evaluation runs */
export async function compareRuns(
  runIdA: string,
  runIdB: string,
): Promise<RunComparison> {
  const [resultA, resultB] = await Promise.all([
    loadRunResult(runIdA),
    loadRunResult(runIdB),
  ]);

  return compareResults(resultA, resultB);
}

/** Compare two run results directly */
export function compareResults(
  resultA: RunResult,
  resultB: RunResult,
): RunComparison {
  // Find config differences
  const configDiff: Record<string, { a: unknown; b: unknown }> = {};
  const configKeys = new Set([
    ...Object.keys(resultA.config),
    ...Object.keys(resultB.config),
  ]);

  for (const key of configKeys) {
    const aVal = (resultA.config as unknown as Record<string, unknown>)[key];
    const bVal = (resultB.config as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(aVal) !== JSON.stringify(bVal)) {
      configDiff[key] = { a: aVal, b: bVal };
    }
  }

  // Compare per-task results
  const taskMapA = new Map(resultA.tasks.map((t) => [t.task_id, t]));
  const taskMapB = new Map(resultB.tasks.map((t) => [t.task_id, t]));
  const allTaskIds = new Set([...taskMapA.keys(), ...taskMapB.keys()]);

  const taskDiffs: TaskDiff[] = [];
  for (const taskId of allTaskIds) {
    const a = taskMapA.get(taskId);
    const b = taskMapB.get(taskId);

    const passA = a?.pass ?? false;
    const passB = b?.pass ?? false;

    let status: TaskDiff["status"] = "unchanged";
    if (!passA && passB) status = "improved";
    else if (passA && !passB) status = "regressed";

    taskDiffs.push({
      task_id: taskId,
      pass: { a: passA, b: passB },
      tokens: { a: a?.tokens ?? 0, b: b?.tokens ?? 0 },
      duration_s: { a: a?.duration_s ?? 0, b: b?.duration_s ?? 0 },
      status,
    });
  }

  // Summary comparison
  const sa = resultA.summary;
  const sb = resultB.summary;

  return {
    run_a: resultA.run_id,
    run_b: resultB.run_id,
    config_diff: configDiff,
    task_diffs: taskDiffs,
    summary_diff: {
      pass_rate: {
        a: sa.pass_rate,
        b: sb.pass_rate,
        delta: sb.pass_rate - sa.pass_rate,
      },
      total_tokens: {
        a: sa.total_tokens,
        b: sb.total_tokens,
        delta: sb.total_tokens - sa.total_tokens,
      },
      total_cost_usd: {
        a: sa.total_cost_usd,
        b: sb.total_cost_usd,
        delta: sb.total_cost_usd - sa.total_cost_usd,
      },
      avg_duration_s: {
        a: sa.avg_duration_s,
        b: sb.avg_duration_s,
        delta: sb.avg_duration_s - sa.avg_duration_s,
      },
    },
  };
}

/** Format a comparison as a human-readable report */
export function formatComparison(comparison: RunComparison): string {
  const lines: string[] = [];

  lines.push(`# Evaluation Comparison: ${comparison.run_a} vs ${comparison.run_b}`);
  lines.push("");

  // Config diff
  if (Object.keys(comparison.config_diff).length > 0) {
    lines.push("## Configuration Differences");
    lines.push("");
    lines.push("| Parameter | Run A | Run B |");
    lines.push("|-----------|-------|-------|");
    for (const [key, { a, b }] of Object.entries(comparison.config_diff)) {
      lines.push(`| ${key} | ${JSON.stringify(a)} | ${JSON.stringify(b)} |`);
    }
    lines.push("");
  }

  // Summary comparison
  const sd = comparison.summary_diff;
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Run A | Run B | Delta |");
  lines.push("|--------|-------|-------|-------|");
  lines.push(
    `| Pass Rate | ${(sd.pass_rate.a * 100).toFixed(1)}% | ${(sd.pass_rate.b * 100).toFixed(1)}% | ${sd.pass_rate.delta > 0 ? "+" : ""}${(sd.pass_rate.delta * 100).toFixed(1)}% |`,
  );
  lines.push(
    `| Total Tokens | ${sd.total_tokens.a.toLocaleString()} | ${sd.total_tokens.b.toLocaleString()} | ${sd.total_tokens.delta > 0 ? "+" : ""}${sd.total_tokens.delta.toLocaleString()} |`,
  );
  lines.push(
    `| Total Cost | $${sd.total_cost_usd.a.toFixed(2)} | $${sd.total_cost_usd.b.toFixed(2)} | ${sd.total_cost_usd.delta > 0 ? "+" : ""}$${sd.total_cost_usd.delta.toFixed(2)} |`,
  );
  lines.push(
    `| Avg Duration | ${sd.avg_duration_s.a}s | ${sd.avg_duration_s.b}s | ${sd.avg_duration_s.delta > 0 ? "+" : ""}${sd.avg_duration_s.delta}s |`,
  );
  lines.push("");

  // Per-task comparison
  const improved = comparison.task_diffs.filter(
    (t) => t.status === "improved",
  );
  const regressed = comparison.task_diffs.filter(
    (t) => t.status === "regressed",
  );

  if (improved.length > 0) {
    lines.push(`## Improved Tasks (${improved.length})`);
    lines.push("");
    for (const t of improved) {
      lines.push(`- **${t.task_id}**: FAIL -> PASS`);
    }
    lines.push("");
  }

  if (regressed.length > 0) {
    lines.push(`## Regressed Tasks (${regressed.length})`);
    lines.push("");
    for (const t of regressed) {
      lines.push(`- **${t.task_id}**: PASS -> FAIL`);
    }
    lines.push("");
  }

  // Full task table
  lines.push("## All Tasks");
  lines.push("");
  lines.push("| Task | Run A | Run B | Status | Tokens A | Tokens B | Time A | Time B |");
  lines.push("|------|-------|-------|--------|----------|----------|--------|--------|");
  for (const t of comparison.task_diffs) {
    const statusIcon =
      t.status === "improved"
        ? "UP"
        : t.status === "regressed"
          ? "DOWN"
          : "-";
    lines.push(
      `| ${t.task_id} | ${t.pass.a ? "PASS" : "FAIL"} | ${t.pass.b ? "PASS" : "FAIL"} | ${statusIcon} | ${t.tokens.a} | ${t.tokens.b} | ${t.duration_s.a}s | ${t.duration_s.b}s |`,
    );
  }

  return lines.join("\n");
}
