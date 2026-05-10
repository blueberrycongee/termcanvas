import test from "node:test";
import assert from "node:assert/strict";

import { PaintHeartbeatWatchdog } from "../src/terminal/paintHeartbeat.ts";
import type {
  RenderableSurface,
  SurfaceHealth,
} from "../shared/render-surface.ts";
import { VisibilityObserver } from "../src/terminal/visibilityObserver.ts";

interface FakeSurface extends RenderableSurface {
  setHealth(next: Partial<SurfaceHealth>): void;
}

function makeSurface(id: string, initial: SurfaceHealth): FakeSurface {
  let health = { ...initial };
  return {
    id,
    kind: "terminal",
    setVisible() {},
    forceRepaint() {
      health = { ...health, lastPaintAt: Date.now() };
    },
    getHealth() {
      return { ...health };
    },
    setHealth(next) {
      health = { ...health, ...next };
    },
  };
}

interface Harness {
  observer: VisibilityObserver;
  observerDispatched: Array<{ reason: string; severity: string }>;
  diagnostics: Array<{ kind: string; data?: Record<string, unknown> }>;
  watchdog: PaintHeartbeatWatchdog;
  documentVisibleRef: { value: boolean };
  nowRef: { value: number };
  surfaces: FakeSurface[];
}

function makeHarness(opts?: {
  intervalMs?: number;
  stallThresholdMs?: number;
  cooldownMs?: number;
}): Harness {
  const observerDispatched: Harness["observerDispatched"] = [];
  const diagnostics: Harness["diagnostics"] = [];
  const documentVisibleRef = { value: true };
  const nowRef = { value: 1_000_000 };
  const surfaces: FakeSurface[] = [];

  const observer = new VisibilityObserver({
    now: () => nowRef.value,
    dedupWindowMs: 0,
  });
  observer.onRecovery((event) => {
    observerDispatched.push({ reason: event.reason, severity: event.severity });
  });

  const watchdog = new PaintHeartbeatWatchdog({
    observer,
    listSurfaces: () => surfaces,
    documentVisible: () => documentVisibleRef.value,
    now: () => nowRef.value,
    recordDiagnostic: (event) => diagnostics.push(event),
    intervalMs: opts?.intervalMs ?? 2000,
    stallThresholdMs: opts?.stallThresholdMs ?? 5000,
    cooldownMs: opts?.cooldownMs ?? 10000,
    setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearIntervalFn: () => {},
  });

  return {
    observer,
    observerDispatched,
    diagnostics,
    watchdog,
    documentVisibleRef,
    nowRef,
    surfaces,
  };
}

test("no dispatch when no surfaces are registered", () => {
  const h = makeHarness();
  h.watchdog.tick();
  assert.deepEqual(h.observerDispatched, []);
});

test("no dispatch when document is hidden — no paints expected", () => {
  const h = makeHarness();
  h.documentVisibleRef.value = false;

  h.surfaces.push(
    makeSurface("a", {
      visible: true,
      lastPaintAt: h.nowRef.value - 60_000, // very stale
      contextLost: false,
      rendererMode: "webgl",
    }),
  );

  h.watchdog.tick();
  assert.deepEqual(h.observerDispatched, []);
});

test("dispatches paint_heartbeat_stall when a visible surface's lastPaintAt is older than threshold", () => {
  const h = makeHarness({ stallThresholdMs: 5000 });

  h.surfaces.push(
    makeSurface("stuck", {
      visible: true,
      lastPaintAt: h.nowRef.value - 6000,
      contextLost: false,
      rendererMode: "webgl",
    }),
  );

  h.watchdog.tick();
  assert.deepEqual(h.observerDispatched, [
    { reason: "paint_heartbeat_stall", severity: "heavy" },
  ]);
  const detected = h.diagnostics.find(
    (d) => d.kind === "paint_heartbeat_stall_detected",
  );
  assert.ok(detected);
  assert.equal(
    (detected!.data!.stalled as Array<{ id: string }>)[0]!.id,
    "stuck",
  );
});

test("does not dispatch when surface paints are recent", () => {
  const h = makeHarness({ stallThresholdMs: 5000 });
  h.surfaces.push(
    makeSurface("ok", {
      visible: true,
      lastPaintAt: h.nowRef.value - 1000,
      contextLost: false,
      rendererMode: "webgl",
    }),
  );
  h.watchdog.tick();
  assert.deepEqual(h.observerDispatched, []);
});

test("hidden surfaces are skipped even when their lastPaintAt is stale", () => {
  const h = makeHarness({ stallThresholdMs: 5000 });
  h.surfaces.push(
    makeSurface("offscreen", {
      visible: false,
      lastPaintAt: h.nowRef.value - 60_000,
      contextLost: false,
      rendererMode: "webgl",
    }),
  );
  h.watchdog.tick();
  assert.deepEqual(h.observerDispatched, []);
});

test("never-painted surface dispatches once the visible window exceeds threshold", () => {
  const h = makeHarness({ stallThresholdMs: 5000, cooldownMs: 0 });
  h.surfaces.push(
    makeSurface("fresh", {
      visible: true,
      lastPaintAt: null,
      contextLost: false,
      rendererMode: "webgl",
    }),
  );

  h.watchdog.tick(); // first tick: starts tracking
  assert.deepEqual(h.observerDispatched, []);

  h.nowRef.value += 6000;
  h.watchdog.tick(); // second tick: 6 s past first-seen, stalled
  assert.deepEqual(h.observerDispatched, [
    { reason: "paint_heartbeat_stall", severity: "heavy" },
  ]);
});

test("cooldown prevents rapid re-dispatch even if stall persists", () => {
  const h = makeHarness({ stallThresholdMs: 5000, cooldownMs: 10000 });
  h.surfaces.push(
    makeSurface("stuck", {
      visible: true,
      lastPaintAt: h.nowRef.value - 6000,
      contextLost: false,
      rendererMode: "webgl",
    }),
  );

  h.watchdog.tick();
  assert.equal(h.observerDispatched.length, 1);

  // 5 s later, surface still stalled — but we're in cooldown.
  h.nowRef.value += 5000;
  h.surfaces[0]!.setHealth({ lastPaintAt: h.nowRef.value - 11_000 });
  h.watchdog.tick();
  assert.equal(h.observerDispatched.length, 1);
  assert.ok(
    h.diagnostics.some(
      (d) => d.kind === "paint_heartbeat_stall_skipped_cooldown",
    ),
  );

  // 11 s after first dispatch, cooldown expires.
  h.nowRef.value += 6000;
  h.surfaces[0]!.setHealth({ lastPaintAt: h.nowRef.value - 12_000 });
  h.watchdog.tick();
  assert.equal(h.observerDispatched.length, 2);
});

test("a paint update inside the stall threshold window clears the dispatch trigger", () => {
  const h = makeHarness({ stallThresholdMs: 5000, cooldownMs: 0 });
  h.surfaces.push(
    makeSurface("recovers", {
      visible: true,
      lastPaintAt: null,
      contextLost: false,
      rendererMode: "webgl",
    }),
  );

  h.watchdog.tick(); // first-seen tracked
  h.nowRef.value += 4000;
  h.surfaces[0]!.setHealth({ lastPaintAt: h.nowRef.value }); // surface paints
  h.nowRef.value += 100;
  h.watchdog.tick();

  assert.deepEqual(h.observerDispatched, []);
});

test("transition document hidden → visible clears stale first-seen tracking", () => {
  const h = makeHarness({ stallThresholdMs: 5000, cooldownMs: 0 });
  h.surfaces.push(
    makeSurface("a", {
      visible: true,
      lastPaintAt: null,
      contextLost: false,
      rendererMode: "webgl",
    }),
  );

  h.watchdog.tick(); // begin tracking first-seen at T

  h.documentVisibleRef.value = false;
  h.nowRef.value += 60_000;
  h.watchdog.tick(); // hidden → resets tracking

  h.documentVisibleRef.value = true;
  h.watchdog.tick(); // tracking restarts at this moment, no stall yet
  assert.deepEqual(h.observerDispatched, []);

  h.nowRef.value += 4000;
  h.watchdog.tick(); // 4 s after restart, still under threshold
  assert.deepEqual(h.observerDispatched, []);
});

test("a misbehaving getHealth on one surface doesn't kill the tick for others", () => {
  const h = makeHarness({ stallThresholdMs: 5000 });
  const broken: RenderableSurface = {
    id: "broken",
    kind: "terminal",
    setVisible() {},
    forceRepaint() {},
    getHealth() {
      throw new Error("nope");
    },
  };
  h.surfaces.push(broken as FakeSurface);
  h.surfaces.push(
    makeSurface("stuck", {
      visible: true,
      lastPaintAt: h.nowRef.value - 6000,
      contextLost: false,
      rendererMode: "webgl",
    }),
  );

  h.watchdog.tick();
  assert.equal(h.observerDispatched.length, 1);
});
