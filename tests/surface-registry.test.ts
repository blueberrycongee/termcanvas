import test from "node:test";
import assert from "node:assert/strict";

import {
  __resetSurfaceRegistryForTesting,
  dispatchSurfaceRecovery,
  getSurface,
  getSurfaceHealth,
  listSurfaces,
  listSurfacesByKind,
  registerSurface,
  unregisterSurface,
} from "../src/terminal/surfaceRegistry.ts";
import type {
  RenderableSurface,
  SurfaceHealth,
  SurfaceKind,
  SurfaceRecoverySeverity,
} from "../shared/render-surface.ts";

interface FakeSurfaceController {
  surface: RenderableSurface;
  visibleCalls: boolean[];
  repaintCalls: Array<{ reason: string; severity: SurfaceRecoverySeverity }>;
  health: SurfaceHealth;
}

function makeFake(
  id: string,
  kind: SurfaceKind = "terminal",
  health: Partial<SurfaceHealth> = {},
): FakeSurfaceController {
  const visibleCalls: boolean[] = [];
  const repaintCalls: FakeSurfaceController["repaintCalls"] = [];
  const fullHealth: SurfaceHealth = {
    visible: true,
    lastPaintAt: null,
    contextLost: false,
    rendererMode: "webgl",
    ...health,
  };
  const surface: RenderableSurface = {
    id,
    kind,
    setVisible(v) {
      visibleCalls.push(v);
    },
    forceRepaint(reason, severity) {
      repaintCalls.push({ reason, severity });
    },
    getHealth() {
      return fullHealth;
    },
  };
  return { surface, visibleCalls, repaintCalls, health: fullHealth };
}

test("registerSurface adds to list and returns dispose fn", () => {
  __resetSurfaceRegistryForTesting();
  const a = makeFake("a");
  const dispose = registerSurface(a.surface);

  assert.equal(listSurfaces().length, 1);
  assert.equal(getSurface("a"), a.surface);
  assert.deepEqual(listSurfacesByKind("terminal"), [a.surface]);
  assert.deepEqual(listSurfacesByKind("monaco"), []);

  dispose();
  assert.equal(listSurfaces().length, 0);
  assert.equal(getSurface("a"), null);
});

test("registerSurface replaces silently on duplicate id", () => {
  __resetSurfaceRegistryForTesting();
  const a1 = makeFake("a");
  const a2 = makeFake("a");
  registerSurface(a1.surface);
  registerSurface(a2.surface);

  assert.equal(listSurfaces().length, 1);
  assert.equal(getSurface("a"), a2.surface);
});

test("dispatchSurfaceRecovery walks every surface and tallies counters", () => {
  __resetSurfaceRegistryForTesting();
  const a = makeFake("a");
  const b = makeFake("b", "monaco");
  registerSurface(a.surface);
  registerSurface(b.surface);

  const result = dispatchSurfaceRecovery("test", "heavy");

  assert.deepEqual(result, { total: 2, refreshed: 2, errors: 0 });
  assert.deepEqual(a.repaintCalls, [{ reason: "test", severity: "heavy" }]);
  assert.deepEqual(b.repaintCalls, [{ reason: "test", severity: "heavy" }]);
});

test("dispatchSurfaceRecovery isolates a throwing surface from the rest", () => {
  __resetSurfaceRegistryForTesting();
  const a = makeFake("a");
  const broken: RenderableSurface = {
    id: "broken",
    kind: "terminal",
    setVisible() {},
    forceRepaint() {
      throw new Error("boom");
    },
    getHealth() {
      return {
        visible: false,
        lastPaintAt: null,
        contextLost: true,
        rendererMode: "unknown",
      };
    },
  };
  const c = makeFake("c");
  registerSurface(a.surface);
  registerSurface(broken);
  registerSurface(c.surface);

  const result = dispatchSurfaceRecovery("test", "light");

  assert.equal(result.total, 3);
  assert.equal(result.refreshed, 2);
  assert.equal(result.errors, 1);
  assert.deepEqual(a.repaintCalls, [{ reason: "test", severity: "light" }]);
  assert.deepEqual(c.repaintCalls, [{ reason: "test", severity: "light" }]);
});

test("getSurfaceHealth returns null for unknown ids and the result for known", () => {
  __resetSurfaceRegistryForTesting();
  const a = makeFake("a", "terminal", { visible: true, contextLost: true });
  registerSurface(a.surface);

  assert.equal(getSurfaceHealth("missing"), null);
  assert.deepEqual(getSurfaceHealth("a"), a.health);
});

test("unregisterSurface removes it from listSurfacesByKind", () => {
  __resetSurfaceRegistryForTesting();
  const a = makeFake("a", "terminal");
  const b = makeFake("b", "terminal");
  const c = makeFake("c", "monaco");
  registerSurface(a.surface);
  registerSurface(b.surface);
  registerSurface(c.surface);

  unregisterSurface("a");

  assert.deepEqual(
    listSurfacesByKind("terminal").map((s) => s.id),
    ["b"],
  );
  assert.deepEqual(
    listSurfacesByKind("monaco").map((s) => s.id),
    ["c"],
  );
});
