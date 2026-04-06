import test from "node:test";
import assert from "node:assert/strict";

import { prioritizeBoxSelectionItems } from "../src/hooks/useBoxSelect.ts";

test("prioritizeBoxSelectionItems prefers annotations over parent scene containers", () => {
  const items = prioritizeBoxSelectionItems([
    { type: "project", projectId: "project-1" },
    { type: "worktree", projectId: "project-1", worktreeId: "worktree-1" },
    { type: "annotation", annotationId: "annotation-1" },
  ]);

  assert.deepEqual(items, [{ type: "annotation", annotationId: "annotation-1" }]);
});

test("prioritizeBoxSelectionItems prefers cards over project hits", () => {
  const items = prioritizeBoxSelectionItems([
    { type: "project", projectId: "project-1" },
    { type: "card", cardId: "browser:card-1" },
  ]);

  assert.deepEqual(items, [{ type: "card", cardId: "browser:card-1" }]);
});
