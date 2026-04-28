import test from "node:test";
import assert from "node:assert/strict";

import {
  VisibilityObserver,
  type RecoveryEvent,
  type VisibilityObserverDiagnosticEvent,
} from "../src/terminal/visibilityObserver.ts";

interface FakeClock {
  now: number;
  advance(ms: number): void;
}

function createClock(): FakeClock {
  return {
    now: 1_000_000,
    advance(ms: number) {
      this.now += ms;
    },
  };
}

test("dispatch emits to all listeners with reason and severity", () => {
  const clock = createClock();
  const observer = new VisibilityObserver({ now: () => clock.now });

  const a: RecoveryEvent[] = [];
  const b: RecoveryEvent[] = [];
  observer.onRecovery((event) => a.push(event));
  observer.onRecovery((event) => b.push(event));

  observer.dispatch("test_reason", "heavy");

  assert.deepEqual(a, [{ reason: "test_reason", severity: "heavy" }]);
  assert.deepEqual(b, [{ reason: "test_reason", severity: "heavy" }]);
});

test("a misbehaving listener does not break the others", () => {
  const observer = new VisibilityObserver();
  const events: RecoveryEvent[] = [];
  observer.onRecovery(() => {
    throw new Error("boom");
  });
  observer.onRecovery((e) => events.push(e));

  observer.dispatch("test", "light");

  assert.equal(events.length, 1);
});

test("two heavy events within dedup window: only first dispatches", () => {
  const clock = createClock();
  const observer = new VisibilityObserver({
    now: () => clock.now,
    dedupWindowMs: 200,
  });
  const events: RecoveryEvent[] = [];
  observer.onRecovery((e) => events.push(e));

  observer.dispatch("first", "heavy");
  clock.advance(50);
  observer.dispatch("second", "heavy");

  assert.equal(events.length, 1);
  assert.equal(events[0].reason, "first");
});

test("two heavy events past dedup window: both dispatch", () => {
  const clock = createClock();
  const observer = new VisibilityObserver({
    now: () => clock.now,
    dedupWindowMs: 200,
  });
  const events: RecoveryEvent[] = [];
  observer.onRecovery((e) => events.push(e));

  observer.dispatch("first", "heavy");
  clock.advance(250);
  observer.dispatch("second", "heavy");

  assert.equal(events.length, 2);
});

test("light event right after heavy is suppressed (heavy already covers it)", () => {
  const clock = createClock();
  const observer = new VisibilityObserver({
    now: () => clock.now,
    dedupWindowMs: 200,
  });
  const events: RecoveryEvent[] = [];
  observer.onRecovery((e) => events.push(e));

  observer.dispatch("visibility", "heavy");
  clock.advance(50);
  observer.dispatch("focus", "light");

  assert.equal(events.length, 1);
  assert.equal(events[0].severity, "heavy");
});

test("heavy event after light upgrades — both dispatch (atlas rebuild needed)", () => {
  const clock = createClock();
  const observer = new VisibilityObserver({
    now: () => clock.now,
    dedupWindowMs: 200,
  });
  const events: RecoveryEvent[] = [];
  observer.onRecovery((e) => events.push(e));

  observer.dispatch("focus", "light");
  clock.advance(50);
  observer.dispatch("visibility", "heavy");

  assert.equal(events.length, 2);
  assert.equal(events[0].severity, "light");
  assert.equal(events[1].severity, "heavy");
});

test("two light events within dedup window: only first dispatches", () => {
  const clock = createClock();
  const observer = new VisibilityObserver({
    now: () => clock.now,
    dedupWindowMs: 200,
  });
  const events: RecoveryEvent[] = [];
  observer.onRecovery((e) => events.push(e));

  observer.dispatch("focus_a", "light");
  clock.advance(50);
  observer.dispatch("focus_b", "light");

  assert.equal(events.length, 1);
  assert.equal(events[0].reason, "focus_a");
});

test("diagnostic events record both dispatch and skip with metadata", () => {
  const clock = createClock();
  const diags: VisibilityObserverDiagnosticEvent[] = [];
  const observer = new VisibilityObserver({
    now: () => clock.now,
    dedupWindowMs: 200,
    recordDiagnostic: (event) => diags.push(event),
  });

  observer.dispatch("first", "heavy");
  clock.advance(50);
  observer.dispatch("second", "heavy");
  clock.advance(50);
  observer.dispatch("third", "light");

  const dispatches = diags.filter(
    (d) => d.kind === "visibility_observer_dispatch",
  );
  const skips = diags.filter(
    (d) => d.kind === "visibility_observer_skipped",
  );

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].data?.reason, "first");
  assert.equal(skips.length, 2);
  assert.equal(skips[0].data?.reason, "second");
  assert.equal(skips[0].data?.severity, "heavy");
  assert.equal(skips[1].data?.reason, "third");
  assert.equal(skips[1].data?.superseded_by, "heavy");
});

test("install subscribes to the lifecycle IPC and routes it as heavy", () => {
  const clock = createClock();
  const events: RecoveryEvent[] = [];
  let ipcCallback:
    | ((p: { reason: string; timestamp: number }) => void)
    | null = null;
  const observer = new VisibilityObserver({
    now: () => clock.now,
    subscribeLifecycleIPC: (cb) => {
      ipcCallback = cb;
      return () => {
        ipcCallback = null;
      };
    },
  });
  observer.install();
  observer.onRecovery((e) => events.push(e));

  assert.ok(ipcCallback, "observer should have subscribed via the IPC bridge");
  ipcCallback!({ reason: "browser_window_focus", timestamp: clock.now });

  assert.equal(events.length, 1);
  assert.equal(events[0].severity, "heavy");
  assert.equal(events[0].reason, "lifecycle_ipc_browser_window_focus");
});

test("install is idempotent", () => {
  let subscriptions = 0;
  const observer = new VisibilityObserver({
    subscribeLifecycleIPC: () => {
      subscriptions++;
      return () => {};
    },
  });
  observer.install();
  observer.install();
  observer.install();

  assert.equal(subscriptions, 1);
});

test("uninstall removes the IPC subscription", () => {
  let active = false;
  const observer = new VisibilityObserver({
    subscribeLifecycleIPC: () => {
      active = true;
      return () => {
        active = false;
      };
    },
  });
  observer.install();
  assert.equal(active, true);
  observer.uninstall();
  assert.equal(active, false);
});

test("onRecovery returns an unsubscribe function", () => {
  const observer = new VisibilityObserver();
  const events: RecoveryEvent[] = [];
  const off = observer.onRecovery((e) => events.push(e));

  observer.dispatch("a", "heavy");
  assert.equal(events.length, 1);

  off();
  observer.dispatch("b", "heavy");
  assert.equal(events.length, 1, "unsubscribed listener must not receive");
});
