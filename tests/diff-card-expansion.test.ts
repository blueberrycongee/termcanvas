import test from "node:test";
import assert from "node:assert/strict";

import { toggleExpandedFiles } from "../src/components/diffCardExpansion.ts";

test("expanding a second file keeps the first file expanded", () => {
  const firstExpanded = toggleExpandedFiles(new Set<string>(), "src/App.tsx");
  const bothExpanded = toggleExpandedFiles(firstExpanded, "src/main.tsx");

  assert.deepEqual([...bothExpanded], ["src/App.tsx", "src/main.tsx"]);
});

test("collapsing one file leaves other expanded files untouched", () => {
  const expanded = new Set(["src/App.tsx", "src/main.tsx"]);

  const next = toggleExpandedFiles(expanded, "src/App.tsx");

  assert.deepEqual([...next], ["src/main.tsx"]);
});
