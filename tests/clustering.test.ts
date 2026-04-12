import test from "node:test";
import assert from "node:assert/strict";

interface TileInput {
  id: string;
  width: number;
  height: number;
  tags: string[];
}

test("clusterByTag groups tiles by matching tag prefix", async () => {
  const { clusterByTag } = await import("../src/clustering.ts");

  const tiles: TileInput[] = [
    { id: "t1", width: 640, height: 480, tags: ["project:app"] },
    { id: "t2", width: 640, height: 480, tags: ["project:app"] },
    { id: "t3", width: 640, height: 480, tags: ["project:backend"] },
  ];

  const result = clusterByTag(tiles, "project");
  const t1 = result.get("t1");
  const t2 = result.get("t2");
  const t3 = result.get("t3");

  assert.ok(t1 && t2 && t3);
  assert.equal(result.size, 3);

  const distSameGroup = Math.hypot(t2.x - t1.x, t2.y - t1.y);
  assert.ok(
    distSameGroup < 700,
    `same-group distance ${distSameGroup} should be < 700`,
  );

  const distDiffGroup = Math.hypot(t3.x - t1.x, t3.y - t1.y);
  assert.ok(
    distDiffGroup > distSameGroup,
    "different groups should be further apart",
  );
});

test("clusterByTag handles tiles with no matching tag", async () => {
  const { clusterByTag } = await import("../src/clustering.ts");

  const tiles: TileInput[] = [
    { id: "t1", width: 640, height: 480, tags: ["project:app"] },
    { id: "t2", width: 640, height: 480, tags: [] },
  ];

  const result = clusterByTag(tiles, "project");
  assert.equal(result.size, 2);
  assert.ok(result.has("t2"));
});

test("clusterByTag with empty input returns empty map", async () => {
  const { clusterByTag } = await import("../src/clustering.ts");
  const result = clusterByTag([], "project");
  assert.equal(result.size, 0);
});

test("packGroup arranges tiles in a compact grid", async () => {
  const { packGroup } = await import("../src/clustering.ts");

  const tiles = [
    { id: "t1", width: 640, height: 480 },
    { id: "t2", width: 640, height: 480 },
    { id: "t3", width: 640, height: 480 },
    { id: "t4", width: 640, height: 480 },
  ];

  const result = packGroup(tiles, 0, 0);
  assert.equal(result.length, 4);
  assert.equal(result[0]?.x, 0);
  assert.equal(result[0]?.y, 0);

  for (let i = 0; i < result.length; i += 1) {
    for (let j = i + 1; j < result.length; j += 1) {
      const a = result[i];
      const b = result[j];
      const overlapX = a.x < b.x + tiles[j].width && a.x + tiles[i].width > b.x;
      const overlapY = a.y < b.y + tiles[j].height && a.y + tiles[i].height > b.y;
      assert.ok(!(overlapX && overlapY), `tiles ${i} and ${j} overlap`);
    }
  }
});
