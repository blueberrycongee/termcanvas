import test from "node:test";
import assert from "node:assert/strict";

import { createTerminalSurface, type TerminalSurfaceRuntimeView } from "../src/terminal/terminalSurface.ts";

interface FakeRuntime {
  id: string;
  live: boolean;
  attached: boolean;
  rendererMode: "webgl" | "canvas" | "dom" | "unknown";
  refreshCalls: number;
  refreshShouldFail: boolean;
  paintCallbacks: Array<() => void>;
}

function makeView(runtime: FakeRuntime): TerminalSurfaceRuntimeView {
  return {
    id: runtime.id,
    isLive: () => runtime.live,
    isAttached: () => runtime.attached,
    rendererMode: () => runtime.rendererMode,
    refreshXterm: () => {
      runtime.refreshCalls += 1;
      return !runtime.refreshShouldFail;
    },
    onPaint: (cb) => {
      runtime.paintCallbacks.push(cb);
      return () => {
        runtime.paintCallbacks = runtime.paintCallbacks.filter((c) => c !== cb);
      };
    },
  };
}

function fakeRuntime(): FakeRuntime {
  return {
    id: "term-1",
    live: true,
    attached: true,
    rendererMode: "webgl",
    refreshCalls: 0,
    refreshShouldFail: false,
    paintCallbacks: [],
  };
}

test("forceRepaint refreshes xterm and only resets WebGL on heavy", () => {
  const runtime = fakeRuntime();
  const handle = createTerminalSurface(makeView(runtime));

  handle.surface.forceRepaint("test_light", "light");
  assert.equal(runtime.refreshCalls, 1);

  handle.surface.forceRepaint("test_heavy", "heavy");
  assert.equal(runtime.refreshCalls, 2);
  // (We can't easily assert the WebGL reset path without the real
  // webglContextPool — that's covered by the existing
  // terminal-runtime-store.test.ts integration test. Here we cover the
  // refresh tally.)
});

test("getHealth gates visible on live + attached + visibleHint", () => {
  const runtime = fakeRuntime();
  const handle = createTerminalSurface(makeView(runtime));

  // Default: visibleHint is true; runtime is live + attached.
  assert.equal(handle.surface.getHealth().visible, true);

  // Detach the runtime.
  runtime.attached = false;
  assert.equal(handle.surface.getHealth().visible, false);

  // Re-attach but set hint to false.
  runtime.attached = true;
  handle.setVisibleHint(false);
  assert.equal(handle.surface.getHealth().visible, false);

  // Re-enable hint.
  handle.setVisibleHint(true);
  assert.equal(handle.surface.getHealth().visible, true);

  // Mark not-live (disposed).
  runtime.live = false;
  assert.equal(handle.surface.getHealth().visible, false);
});

test("paint callbacks bump lastPaintAt and clear contextLost", () => {
  const runtime = fakeRuntime();
  const handle = createTerminalSurface(makeView(runtime));

  // Initial state.
  assert.equal(handle.surface.getHealth().lastPaintAt, null);

  handle.markContextLost();
  assert.equal(handle.surface.getHealth().contextLost, true);

  // Trigger a paint via the subscribed onPaint callback.
  for (const cb of runtime.paintCallbacks) cb();

  const health = handle.surface.getHealth();
  assert.ok(
    health.lastPaintAt !== null && health.lastPaintAt > 0,
    "lastPaintAt should be set after a paint event",
  );
  // A successful paint after a context-loss event clears the flag.
  assert.equal(health.contextLost, false);
});

test("rendererMode reflects what the runtime currently reports", () => {
  const runtime = fakeRuntime();
  const handle = createTerminalSurface(makeView(runtime));

  assert.equal(handle.surface.getHealth().rendererMode, "webgl");

  runtime.rendererMode = "canvas";
  assert.equal(handle.surface.getHealth().rendererMode, "canvas");
});

test("dispose tears down the paint subscription", () => {
  const runtime = fakeRuntime();
  const handle = createTerminalSurface(makeView(runtime));

  assert.equal(runtime.paintCallbacks.length, 1);

  handle.dispose();

  assert.equal(runtime.paintCallbacks.length, 0);
});
