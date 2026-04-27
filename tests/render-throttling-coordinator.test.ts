import test from "node:test";
import assert from "node:assert/strict";

import {
  RenderThrottlingCoordinator,
  type RenderThrottlingDiagnostic,
} from "../electron/render-throttling-coordinator.ts";

interface FakeClock {
  now: number;
  intervals: Array<{
    id: number;
    callback: () => void;
    intervalMs: number;
  }>;
  nextId: number;
}

function createFakeClock(): FakeClock & {
  setIntervalFn: typeof setInterval;
  clearIntervalFn: typeof clearInterval;
  tick(ms: number): void;
} {
  const state: FakeClock = {
    now: 1_000_000,
    intervals: [],
    nextId: 1,
  };

  const setIntervalFn = ((cb: () => void, ms: number) => {
    const id = state.nextId++;
    state.intervals.push({ id, callback: cb, intervalMs: ms });
    return id as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;

  const clearIntervalFn = ((id: ReturnType<typeof setInterval>) => {
    state.intervals = state.intervals.filter(
      (interval) => interval.id !== (id as unknown as number),
    );
  }) as unknown as typeof clearInterval;

  function tick(ms: number) {
    const targetTime = state.now + ms;
    while (state.now < targetTime) {
      const next = state.intervals
        .map((interval) => ({
          interval,
          fireAt:
            Math.floor((state.now - 1_000_000) / interval.intervalMs + 1) *
              interval.intervalMs +
            1_000_000,
        }))
        .filter((entry) => entry.fireAt <= targetTime)
        .sort((a, b) => a.fireAt - b.fireAt)[0];
      if (!next) break;
      state.now = next.fireAt;
      next.interval.callback();
    }
    state.now = targetTime;
  }

  return Object.assign(state, { setIntervalFn, clearIntervalFn, tick });
}

interface FakeTarget {
  setBackgroundThrottling(allowed: boolean): void;
  calls: boolean[];
}

function createFakeTarget(): FakeTarget {
  const target: FakeTarget = {
    calls: [],
    setBackgroundThrottling(allowed: boolean) {
      target.calls.push(allowed);
    },
  };
  return target;
}

test("coordinator stays in default (throttling allowed) until activity", () => {
  const clock = createFakeClock();
  const target = createFakeTarget();
  const coord = new RenderThrottlingCoordinator({
    target,
    now: () => clock.now,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
  });
  coord.start();
  assert.equal(coord.isThrottlingAllowed(), true);
  assert.equal(target.calls.length, 0);
  clock.tick(60_000);
  assert.equal(target.calls.length, 0, "tick alone should not flip state");
});

test("markActivity flips throttling off and tick flips it back on after window", () => {
  const clock = createFakeClock();
  const target = createFakeTarget();
  const events: RenderThrottlingDiagnostic[] = [];
  const coord = new RenderThrottlingCoordinator({
    target,
    activeWindowMs: 30_000,
    reevaluateIntervalMs: 5_000,
    recordDiagnostic: (event) => events.push(event),
    now: () => clock.now,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
  });
  coord.start();

  coord.markActivity("pty");
  assert.equal(coord.isThrottlingAllowed(), false);
  assert.deepEqual(target.calls, [false]);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "background_throttling_changed");
  assert.equal(events[0].data?.allowed, false);

  clock.tick(20_000);
  assert.equal(
    target.calls.length,
    1,
    "still within active window — no further flips",
  );

  clock.tick(15_000);
  assert.equal(
    coord.isThrottlingAllowed(),
    true,
    "after activeWindowMs elapsed, idle tick should re-enable throttling",
  );
  assert.deepEqual(target.calls, [false, true]);
  assert.equal(events.length, 2);
  assert.equal(events[1].data?.allowed, true);
});

test("repeated markActivity within active window does not re-trigger setBackgroundThrottling", () => {
  const clock = createFakeClock();
  const target = createFakeTarget();
  const coord = new RenderThrottlingCoordinator({
    target,
    activeWindowMs: 30_000,
    reevaluateIntervalMs: 5_000,
    now: () => clock.now,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
  });
  coord.start();

  coord.markActivity("pty");
  assert.deepEqual(target.calls, [false]);

  for (let i = 0; i < 10; i++) {
    clock.tick(1_000);
    coord.markActivity("pty");
  }

  assert.equal(
    target.calls.length,
    1,
    "no extra IPC churn while activity keeps refreshing the window",
  );
});

test("markActivity inside the idle window resets the timer", () => {
  const clock = createFakeClock();
  const target = createFakeTarget();
  const coord = new RenderThrottlingCoordinator({
    target,
    activeWindowMs: 30_000,
    reevaluateIntervalMs: 5_000,
    now: () => clock.now,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
  });
  coord.start();

  coord.markActivity("pty");
  clock.tick(25_000);
  coord.markActivity("pty");
  clock.tick(20_000);
  assert.equal(
    coord.isThrottlingAllowed(),
    false,
    "second markActivity should keep throttling disabled",
  );
  assert.deepEqual(target.calls, [false]);

  clock.tick(15_000);
  assert.equal(coord.isThrottlingAllowed(), true);
  assert.deepEqual(target.calls, [false, true]);
});

test("stop() removes the reevaluation timer", () => {
  const clock = createFakeClock();
  const target = createFakeTarget();
  const coord = new RenderThrottlingCoordinator({
    target,
    activeWindowMs: 30_000,
    reevaluateIntervalMs: 5_000,
    now: () => clock.now,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
  });
  coord.start();
  assert.equal(clock.intervals.length, 1);
  coord.stop();
  assert.equal(clock.intervals.length, 0);
});

test("diagnostic payload includes activity source and ms-since-last-activity", () => {
  const clock = createFakeClock();
  const target = createFakeTarget();
  const events: RenderThrottlingDiagnostic[] = [];
  const coord = new RenderThrottlingCoordinator({
    target,
    activeWindowMs: 10_000,
    reevaluateIntervalMs: 1_000,
    recordDiagnostic: (event) => events.push(event),
    now: () => clock.now,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
  });
  coord.start();

  coord.markActivity("hydra");
  clock.tick(20_000);

  assert.equal(events.length, 2);
  assert.equal(events[0].data?.last_activity_source, "hydra");
  assert.equal(events[1].data?.last_activity_source, "hydra");
  assert.equal(typeof events[1].data?.ms_since_last_activity, "number");
  assert.ok(
    (events[1].data?.ms_since_last_activity as number) >= 10_000,
    "idle flip should report a stale activity timestamp",
  );
});
