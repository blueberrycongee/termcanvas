import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  computeCost,
  parseClaudeSession,
  parseCodexSession,
  parseKimiWireFile,
  parseWuuSession,
  shouldReuseTimedCache,
  shouldReuseUsageSummary,
} from "../electron/usage-collector.ts";
import { parseCodexQuotaFromContent } from "../electron/codex-quota-fetcher.ts";

test("shouldReuseUsageSummary keeps historical dates hot indefinitely in-process", () => {
  const now = new Date("2026-03-21T12:00:00Z").getTime();
  const cachedAt = new Date("2026-03-20T00:00:00Z").getTime();

  assert.equal(
    shouldReuseUsageSummary("2026-03-20", cachedAt, now),
    true,
  );
});

test("shouldReuseUsageSummary expires today's cache after its ttl", () => {
  const now = new Date("2026-03-21T12:00:31Z").getTime();
  const cachedAt = new Date("2026-03-21T12:00:00Z").getTime();

  assert.equal(
    shouldReuseUsageSummary("2026-03-21", cachedAt, now),
    false,
  );
});

test("shouldReuseTimedCache respects ttl windows", () => {
  const cachedAt = 1_000;
  assert.equal(shouldReuseTimedCache(cachedAt, 500, 1_400), true);
  assert.equal(shouldReuseTimedCache(cachedAt, 500, 1_501), false);
});

function writeCodexJsonl(lines: object[]): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
  const filePath = path.join(tmpDir, "test-session.jsonl");
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n"));
  return filePath;
}

test("parseCodexSession subtracts cached_input_tokens from input_tokens", () => {
  const filePath = writeCodexJsonl([
    {
      timestamp: "2026-03-20T10:00:00Z",
      type: "session_meta",
      payload: { cwd: "/tmp/test-project" },
    },
    {
      timestamp: "2026-03-20T10:01:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100_000,
            cached_input_tokens: 80_000,
            output_tokens: 5_000,
            total_tokens: 105_000,
          },
        },
      },
    },
  ]);

  const { records } = parseCodexSession(
    filePath,
    "2026-03-20T00:00:00",
    "2026-03-21T00:00:00",
  );

  assert.equal(records.length, 1);
  const r = records[0];
  assert.equal(r.input, 20_000);
  assert.equal(r.cacheRead, 80_000);
  assert.equal(r.output, 5_000);

  fs.rmSync(path.dirname(filePath), { recursive: true });
});

test("parseCodexSession derives per-event deltas from cumulative token_count events", () => {
  const filePath = writeCodexJsonl([
    {
      timestamp: "2026-03-20T10:00:00Z",
      type: "session_meta",
      payload: { cwd: "/tmp/test-project" },
    },
    {
      timestamp: "2026-03-20T10:01:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 10_000,
            cached_input_tokens: 5_000,
            output_tokens: 1_000,
            total_tokens: 11_000,
          },
        },
      },
    },
    {
      timestamp: "2026-03-20T10:02:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 50_000,
            cached_input_tokens: 40_000,
            output_tokens: 3_000,
            total_tokens: 53_000,
          },
        },
      },
    },
  ]);

  const { records } = parseCodexSession(
    filePath,
    "2026-03-20T00:00:00",
    "2026-03-21T00:00:00",
  );

  assert.equal(records.length, 2);

  const first = records[0];
  assert.equal(first.input, 5_000);
  assert.equal(first.cacheRead, 5_000);
  assert.equal(first.output, 1_000);

  const second = records[1];
  assert.equal(second.input, 5_000);
  assert.equal(second.cacheRead, 35_000);
  assert.equal(second.output, 2_000);

  fs.rmSync(path.dirname(filePath), { recursive: true });
});

test("parseCodexSession clamps input to zero when cached exceeds total", () => {
  const filePath = writeCodexJsonl([
    {
      timestamp: "2026-03-20T10:00:00Z",
      type: "session_meta",
      payload: { cwd: "/tmp/test-project" },
    },
    {
      timestamp: "2026-03-20T10:01:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 200,  // malformed: cached > total
            output_tokens: 50,
            total_tokens: 150,
          },
        },
      },
    },
  ]);

  const { records } = parseCodexSession(
    filePath,
    "2026-03-20T00:00:00",
    "2026-03-21T00:00:00",
  );

  assert.equal(records.length, 1);
  assert.equal(records[0].input, 0);  // clamped, not negative
  assert.equal(records[0].cacheRead, 200);

  fs.rmSync(path.dirname(filePath), { recursive: true });
});

test("parseCodexSession ignores model_provider aliases and uses turn_context model", () => {
  const filePath = writeCodexJsonl([
    {
      timestamp: "2026-03-20T10:00:00Z",
      type: "session_meta",
      payload: {
        cwd: "/tmp/test-project",
        model_provider: "gmn",
      },
    },
    {
      timestamp: "2026-03-20T10:00:30Z",
      type: "turn_context",
      payload: {
        model: "gpt-5.4",
      },
    },
    {
      timestamp: "2026-03-20T10:01:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100_000,
            cached_input_tokens: 80_000,
            output_tokens: 5_000,
            total_tokens: 105_000,
          },
        },
      },
    },
  ]);

  const { records } = parseCodexSession(
    filePath,
    "2026-03-20T00:00:00",
    "2026-03-21T00:00:00",
  );

  assert.equal(records.length, 1);
  assert.equal(records[0].model, "gpt-5.4");

  fs.rmSync(path.dirname(filePath), { recursive: true });
});

test("computeCost applies codex pricing correctly", () => {
  const cost = computeCost("codex", 20_000, 5_000, 80_000, 0, 0);

  const expected = (20_000 / 1e6) * 1.50
                 + (5_000 / 1e6) * 6.00
                 + (80_000 / 1e6) * 0.375;
  assert.equal(Math.abs(cost - expected) < 1e-10, true);
});

test("computeCost applies official gpt-5.4 pricing for Codex CLI sessions", () => {
  const cost = computeCost("gpt-5.4", 20_000, 5_000, 80_000, 0, 0);

  const expected = (20_000 / 1e6) * 2.50
                 + (5_000 / 1e6) * 15.00
                 + (80_000 / 1e6) * 0.25;
  assert.equal(Math.abs(cost - expected) < 1e-10, true);
});

test("computeCost applies official gpt-5.5 pricing for Codex CLI sessions", () => {
  const cost = computeCost("gpt-5.5", 20_000, 5_000, 80_000, 0, 0);

  const expected = (20_000 / 1e6) * 5.00
                 + (5_000 / 1e6) * 30.00
                 + (80_000 / 1e6) * 0.50;
  assert.equal(Math.abs(cost - expected) < 1e-10, true);
});

test("computeCost applies official claude-opus-4-7 pricing", () => {
  const cost = computeCost("claude-opus-4-7", 20_000, 5_000, 80_000, 10_000, 4_000);

  const expected = (20_000 / 1e6) * 5.00
                 + (5_000 / 1e6) * 25.00
                 + (80_000 / 1e6) * 0.50
                 + (10_000 / 1e6) * 6.25
                 + (4_000 / 1e6) * 10.00;
  assert.equal(Math.abs(cost - expected) < 1e-10, true);
});

test("computeCost uses longest prefix match for Codex model snapshots", () => {
  const cost = computeCost("gpt-5.1-codex-mini-2026-04-01", 10_000, 2_000, 40_000, 0, 0);

  const expected = (10_000 / 1e6) * 0.25
                 + (2_000 / 1e6) * 2.00
                 + (40_000 / 1e6) * 0.025;
  assert.equal(Math.abs(cost - expected) < 1e-10, true);
});

test("computeCost applies gpt-5.4 long-context multipliers above 272k input tokens", () => {
  const cost = computeCost("gpt-5.4", 120_000, 8_000, 160_001, 0, 0);

  const expected = (120_000 / 1e6) * 2.50 * 2
                 + (160_001 / 1e6) * 0.25 * 2
                 + (8_000 / 1e6) * 15.00 * 1.5;
  assert.equal(Math.abs(cost - expected) < 1e-10, true);
});

test("parseCodexQuotaFromContent reads primary and secondary rate limits", () => {
  const quota = parseCodexQuotaFromContent([
    JSON.stringify({
      timestamp: "2026-03-20T10:01:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        rate_limits: {
          primary: {
            used_percent: 12,
            window_minutes: 300,
            resets_at: 1_774_390_447,
          },
          secondary: {
            used_percent: 61,
            window_minutes: 10_080,
            resets_at: 1_774_881_282,
          },
        },
      },
    }),
  ].join("\n"));

  assert.ok(quota);
  assert.equal(quota.fiveHour.utilization, 0.12);
  assert.equal(quota.sevenDay.utilization, 0.61);
  assert.equal(quota.fiveHour.resetsAt, "2026-03-24T22:14:07.000Z");
  assert.equal(quota.sevenDay.resetsAt, "2026-03-30T14:34:42.000Z");
});

function writeClaudeJsonl(dirName: string, lines: object[]): { filePath: string; dir: string } {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  const dir = path.join(projectsDir, dirName);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "test-session.jsonl");
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n"));
  return { filePath, dir };
}

const sampleClaudeMessage = [
  {
    timestamp: "2026-03-20T10:00:00Z",
    message: {
      id: "msg_001",
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 0,
      },
    },
  },
];

test("parseClaudeSession maps Hydra .worktrees path to parent project", () => {
  const { filePath, dir } = writeClaudeJsonl(
    "-tmp-test-proj-.worktrees-hydra-abc123",
    sampleClaudeMessage,
  );

  try {
    const { records, projectPath } = parseClaudeSession(
      filePath,
      "2026-03-20T00:00:00",
      "2026-03-21T00:00:00",
    );

    assert.equal(projectPath, "/tmp/test/proj");
    assert.equal(records.length, 1);
    assert.equal(records[0].projectPath, "/tmp/test/proj");
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test("parseClaudeSession maps --worktrees path to parent project", () => {
  const { filePath, dir } = writeClaudeJsonl(
    "-tmp-test-proj--worktrees-feature-branch",
    sampleClaudeMessage,
  );

  try {
    const { records, projectPath } = parseClaudeSession(
      filePath,
      "2026-03-20T00:00:00",
      "2026-03-21T00:00:00",
    );

    assert.equal(projectPath, "/tmp/test/proj");
    assert.equal(records.length, 1);
    assert.equal(records[0].projectPath, "/tmp/test/proj");
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test("parseClaudeSession preserves normal project path (no worktree)", () => {
  const { filePath, dir } = writeClaudeJsonl(
    "-tmp-test-proj",
    sampleClaudeMessage,
  );

  try {
    const { projectPath } = parseClaudeSession(
      filePath,
      "2026-03-20T00:00:00",
      "2026-03-21T00:00:00",
    );

    assert.equal(projectPath, "/tmp/test/proj");
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});


test("parseKimiWireFile accumulates StatusUpdate token_usage records", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-test-"));
  const sessionDir = path.join(tmpDir, "test-session");
  fs.mkdirSync(sessionDir, { recursive: true });
  const wirePath = path.join(sessionDir, "wire.jsonl");

  const lines = [
    JSON.stringify({ timestamp: 1775348199.587724, message: { type: "StatusUpdate", payload: { token_usage: { input_other: 4235, output: 69, input_cache_read: 4608, input_cache_creation: 0 } } } }),
    JSON.stringify({ timestamp: 1775348201.33165, message: { type: "StatusUpdate", payload: { token_usage: { input_other: 315, output: 69, input_cache_read: 8704, input_cache_creation: 0 } } } }),
    JSON.stringify({ timestamp: 1775348204.4787781, message: { type: "ToolResult", payload: { tool_call_id: "ReadFile:1" } } }),
  ];
  fs.writeFileSync(wirePath, lines.join("\n"));

  const { records } = parseKimiWireFile(
    wirePath,
    "2026-04-01T00:00:00",
    "2026-04-10T00:00:00",
  );

  assert.equal(records.length, 2);
  assert.equal(records[0].model, "kimi");
  assert.equal(records[0].input, 4235);
  assert.equal(records[0].output, 69);
  assert.equal(records[0].cacheRead, 4608);
  assert.equal(records[1].input, 315);
  assert.equal(records[1].output, 69);
  assert.equal(records[1].cacheRead, 8704);

  fs.rmSync(tmpDir, { recursive: true });
});

test("parseWuuSession accumulates meta token_usage records", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wuu-test-"));
  const filePath = path.join(tmpDir, "20260413-161133-7209.jsonl");

  const lines = [
    JSON.stringify({ role: "user", content: "hello", at: "2026-04-13T08:11:35.702832Z" }),
    JSON.stringify({ role: "assistant", content: "hi", at: "2026-04-13T08:11:52.229692Z" }),
    JSON.stringify({ role: "meta", content: "token_usage", at: "2026-04-13T08:11:52.230198Z", input_tokens: 2667, output_tokens: 14 }),
    JSON.stringify({ role: "meta", content: "token_usage", at: "2026-04-13T08:12:00.000000Z", input_tokens: 100, output_tokens: 50 }),
  ];
  fs.writeFileSync(filePath, lines.join("\n"));

  const { records } = parseWuuSession(
    filePath,
    "2026-04-13T00:00:00",
    "2026-04-14T00:00:00",
  );

  assert.equal(records.length, 2);
  assert.equal(records[0].model, "wuu");
  assert.equal(records[0].input, 2667);
  assert.equal(records[0].output, 14);
  assert.equal(records[1].input, 100);
  assert.equal(records[1].output, 50);

  fs.rmSync(tmpDir, { recursive: true });
});
