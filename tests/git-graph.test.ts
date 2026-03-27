import test from "node:test";
import assert from "node:assert/strict";

import { buildGitGraph } from "../src/utils/gitGraph.ts";

test("buildGitGraph keeps the first-parent history straight and routes merges onto side lanes", () => {
  const { commits, edges } = buildGitGraph([
    {
      hash: "m",
      parents: ["b", "c"],
      refs: ["HEAD -> main"],
      author: "Test User",
      date: "2026-03-26T00:00:00.000Z",
      message: "merge feature",
    },
    {
      hash: "b",
      parents: ["a"],
      refs: ["main"],
      author: "Test User",
      date: "2026-03-25T00:00:00.000Z",
      message: "main work",
    },
    {
      hash: "c",
      parents: ["a"],
      refs: ["feature"],
      author: "Test User",
      date: "2026-03-24T00:00:00.000Z",
      message: "feature work",
    },
    {
      hash: "a",
      parents: [],
      refs: [],
      author: "Test User",
      date: "2026-03-23T00:00:00.000Z",
      message: "root",
    },
  ]);

  const merge = commits.find((commit) => commit.hash === "m");
  const main = commits.find((commit) => commit.hash === "b");
  const feature = commits.find((commit) => commit.hash === "c");
  const root = commits.find((commit) => commit.hash === "a");

  assert.ok(merge);
  assert.ok(main);
  assert.ok(feature);
  assert.ok(root);
  assert.equal(merge.lane, 0);
  assert.equal(main.lane, 0);
  assert.equal(feature.lane, 1);
  assert.equal(root.lane, 0);
  assert.equal(
    edges.some(
      (edge) =>
        edge.fromHash === "m" &&
        edge.toHash === "c" &&
        edge.fromLane === 0 &&
        edge.fromRow === 0 &&
        edge.toLane === 1 &&
        edge.toRow === 2,
    ),
    true,
  );
  assert.equal(
    edges.some(
      (edge) =>
        edge.fromHash === "m" &&
        edge.toHash === "b" &&
        edge.fromLane === 0 &&
        edge.toLane === 0,
    ),
    true,
  );
});
