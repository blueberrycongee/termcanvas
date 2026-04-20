import test from "node:test";
import assert from "node:assert/strict";

import { shouldRefreshHistorySection } from "../src/components/historySectionModel.ts";

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
