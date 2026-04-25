import test from "node:test";
import assert from "node:assert/strict";

import {
  filterHiddenEntries,
  groupHistoryByProject,
  shouldRefreshHistorySection,
} from "../src/components/historySectionModel.ts";

test("shouldRefreshHistorySection only refreshes overlapping project scopes", () => {
  assert.equal(
    shouldRefreshHistorySection(
      ["/tmp/project-a", "/tmp/project-b"],
      ["/tmp/project-b"],
    ),
    true,
  );
  assert.equal(
    shouldRefreshHistorySection(
      ["/tmp/project-a", "/tmp/project-b"],
      ["/tmp/project-c"],
    ),
    false,
  );
});

test("shouldRefreshHistorySection ignores empty or blank scopes", () => {
  assert.equal(shouldRefreshHistorySection([], ["/tmp/project-a"]), false);
  assert.equal(
    shouldRefreshHistorySection(["   "], ["/tmp/project-a"]),
    false,
  );
  assert.equal(
    shouldRefreshHistorySection(["/tmp/project-a"], []),
    false,
  );
});

test("groupHistoryByProject buckets entries and orders newest-first", () => {
  const entries = [
    { sessionId: "s1", projectDir: "/p/a", lastActivityAt: "2026-04-25T12:00:00Z" },
    { sessionId: "s2", projectDir: "/p/b", lastActivityAt: "2026-04-25T13:00:00Z" },
    { sessionId: "s3", projectDir: "/p/a", lastActivityAt: "2026-04-25T14:00:00Z" },
    { sessionId: "s4", projectDir: "/p/b", lastActivityAt: "2026-04-25T11:00:00Z" },
  ];

  const groups = groupHistoryByProject(entries);

  // Group order: /p/a is newest because s3 (14:00) is the newest of all.
  assert.deepEqual(
    groups.map((g) => g.projectDir),
    ["/p/a", "/p/b"],
  );
  // Within each group, newest-first by lastActivityAt.
  assert.deepEqual(
    groups[0].entries.map((e) => e.sessionId),
    ["s3", "s1"],
  );
  assert.deepEqual(
    groups[1].entries.map((e) => e.sessionId),
    ["s2", "s4"],
  );
});

test("groupHistoryByProject handles empty input", () => {
  assert.deepEqual(groupHistoryByProject([]), []);
});

test("filterHiddenEntries removes entries by sessionId", () => {
  const entries = [
    { sessionId: "s1", projectDir: "/p/a", lastActivityAt: "x" },
    { sessionId: "s2", projectDir: "/p/a", lastActivityAt: "x" },
    { sessionId: "s3", projectDir: "/p/b", lastActivityAt: "x" },
  ];
  const hidden = new Set(["s2"]);
  const result = filterHiddenEntries(entries, hidden);
  assert.deepEqual(result.map((e) => e.sessionId), ["s1", "s3"]);
});

test("filterHiddenEntries returns input unchanged when hidden is empty", () => {
  const entries = [
    { sessionId: "s1", projectDir: "/p/a", lastActivityAt: "x" },
  ];
  const result = filterHiddenEntries(entries, new Set());
  assert.equal(result, entries);
});
