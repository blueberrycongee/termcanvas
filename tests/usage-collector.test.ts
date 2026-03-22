import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  computeCost,
  parseCodexSession,
  shouldReuseTimedCache,
  shouldReuseUsageSummary,
} from "../electron/usage-collector.ts";

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

// ── Codex parsing tests ─────────────────────────────────────────────────

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
  // input should be non-cached portion only
  assert.equal(r.input, 20_000);
  assert.equal(r.cacheRead, 80_000);
  assert.equal(r.output, 5_000);

  fs.rmSync(path.dirname(filePath), { recursive: true });
});

test("parseCodexSession uses last token_count event (cumulative)", () => {
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

  assert.equal(records.length, 1);
  const r = records[0];
  // Should use the last event, not the first
  assert.equal(r.input, 10_000);  // 50_000 - 40_000
  assert.equal(r.cacheRead, 40_000);
  assert.equal(r.output, 3_000);

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

test("computeCost applies codex pricing correctly", () => {
  // 20k non-cached input, 80k cached, 5k output
  const cost = computeCost("codex", 20_000, 5_000, 80_000, 0, 0);

  // Expected: (20k/1M)*1.50 + (5k/1M)*6.00 + (80k/1M)*0.375
  const expected = (20_000 / 1e6) * 1.50
                 + (5_000 / 1e6) * 6.00
                 + (80_000 / 1e6) * 0.375;
  assert.equal(Math.abs(cost - expected) < 1e-10, true);
});
