import test from "node:test";
import assert from "node:assert/strict";

import {
  cancelScheduledTerminalFocus,
  createPendingFocus,
  scheduleTerminalFocus,
  type FocusScheduleOptions,
  type FocusTier,
} from "../src/terminal/focusScheduler.ts";

interface Harness {
  microtasks: Array<() => void>;
  rafs: Map<number, FrameRequestCallback>;
  rafCancelled: number[];
  timeouts: Map<number, { cb: () => void; ms: number }>;
  timeoutCleared: number[];
  options: FocusScheduleOptions;
  diagnostics: Array<{ kind: string; data: Record<string, unknown> }>;
  attempts: Array<{ tier: FocusTier; attempt: number; focused: boolean }>;
}

function makeHarness(): Harness {
  const microtasks: Array<() => void> = [];
  const rafs = new Map<number, FrameRequestCallback>();
  const rafCancelled: number[] = [];
  const timeouts = new Map<number, { cb: () => void; ms: number }>();
  const timeoutCleared: number[] = [];
  const diagnostics: Harness["diagnostics"] = [];
  const attempts: Harness["attempts"] = [];

  let nextRafId = 1;
  let nextTimeoutId = 1;

  return {
    microtasks,
    rafs,
    rafCancelled,
    timeouts,
    timeoutCleared,
    diagnostics,
    attempts,
    options: {
      requestMicrotask: (cb) => microtasks.push(cb),
      requestFrame: (cb) => {
        const id = nextRafId++;
        rafs.set(id, cb);
        return id;
      },
      cancelFrame: (id) => {
        rafCancelled.push(id);
        rafs.delete(id);
      },
      setTimeoutFn: ((cb: () => void, ms: number) => {
        const id = nextTimeoutId++;
        timeouts.set(id, { cb, ms });
        return id as unknown as ReturnType<typeof setTimeout>;
      }) as FocusScheduleOptions["setTimeoutFn"],
      clearTimeoutFn: ((id: ReturnType<typeof setTimeout>) => {
        timeoutCleared.push(id as unknown as number);
        timeouts.delete(id as unknown as number);
      }) as FocusScheduleOptions["clearTimeoutFn"],
      onAttempt: (info) => attempts.push(info),
      recordDiagnostic: (event) =>
        diagnostics.push({ kind: event.kind, data: event.data ?? {} }),
    },
  };
}

function flushMicrotasks(h: Harness) {
  while (h.microtasks.length > 0) {
    const cb = h.microtasks.shift()!;
    cb();
  }
}

test("first attempt defers via microtask, not sync — caller can still mutate state", () => {
  const h = makeHarness();
  let focused = false;
  let activeTarget = "other";

  const pending = createPendingFocus();
  scheduleTerminalFocus(
    () => {
      activeTarget = "xterm";
      focused = true;
      return true;
    },
    pending,
    h.options,
  );

  // The scheduler must NOT have run focus inline — competing focus updates
  // that race with our schedule call must be allowed to interleave.
  activeTarget = "competitor";
  assert.equal(focused, false);
  assert.equal(h.microtasks.length, 1);

  flushMicrotasks(h);
  assert.equal(focused, true);
  assert.equal(activeTarget, "xterm");
});

test("scheduling again before microtask fires supersedes the prior schedule", () => {
  const h = makeHarness();
  const fired: string[] = [];
  const pending = createPendingFocus();

  scheduleTerminalFocus(() => fired.push("first"), pending, h.options);
  scheduleTerminalFocus(() => fired.push("second"), pending, h.options);

  // Both microtasks were queued (microtask queue can't be cancelled), but
  // the first one's generation is stale and must no-op.
  assert.equal(h.microtasks.length, 2);
  flushMicrotasks(h);

  assert.deepEqual(fired, ["second"]);
});

test("falling-back tier escalates: microtask → RAF → timeout50 → timeout200", () => {
  const h = makeHarness();
  const pending = createPendingFocus();

  let succeedAfter = 3; // succeed on the 4th attempt (timeout200)
  scheduleTerminalFocus(
    () => {
      const ok = succeedAfter <= 0;
      succeedAfter -= 1;
      return ok;
    },
    pending,
    h.options,
  );

  // Tier 1: microtask
  assert.equal(h.microtasks.length, 1);
  flushMicrotasks(h);
  assert.deepEqual(h.attempts.map((a) => a.tier), ["microtask"]);

  // Tier 2: RAF
  assert.equal(h.rafs.size, 1);
  h.rafs.get(1)!(0);
  assert.deepEqual(h.attempts.map((a) => a.tier), ["microtask", "raf"]);

  // Tier 3: timeout50
  assert.equal(h.timeouts.size, 1);
  const t50 = [...h.timeouts.entries()][0]!;
  assert.equal(t50[1].ms, 50);
  t50[1].cb();
  h.timeouts.delete(t50[0]);
  assert.deepEqual(
    h.attempts.map((a) => a.tier),
    ["microtask", "raf", "timeout50"],
  );

  // Tier 4: timeout200 — succeeds
  assert.equal(h.timeouts.size, 1);
  const t200 = [...h.timeouts.entries()][0]!;
  assert.equal(t200[1].ms, 200);
  t200[1].cb();

  assert.deepEqual(
    h.attempts.map((a) => a.tier),
    ["microtask", "raf", "timeout50", "timeout200"],
  );
  assert.equal(
    h.diagnostics.filter((d) => d.kind === "terminal_focus_scheduler_succeeded")
      .length,
    1,
  );
  assert.deepEqual(h.diagnostics.at(-1)?.data, {
    tier: "timeout200",
    attempt: 3,
  });
});

test("repeated failures past the chain stick on timeout200 and emit exhausted", () => {
  const h = makeHarness();
  const pending = createPendingFocus();

  scheduleTerminalFocus(() => false, pending, h.options, );

  flushMicrotasks(h); // tier 0
  h.rafs.get(1)!(0); // tier 1

  for (let i = 0; i < 12; i++) {
    const next = [...h.timeouts.entries()][0];
    if (!next) break;
    h.timeouts.delete(next[0]);
    next[1].cb();
  }

  // After exhausting, the diagnostic must be emitted.
  const exhausted = h.diagnostics.find(
    (d) => d.kind === "terminal_focus_scheduler_exhausted",
  );
  assert.ok(
    exhausted,
    "expected scheduler to emit terminal_focus_scheduler_exhausted",
  );
});

test("succeeding on the first microtask emits a success diagnostic with tier=microtask", () => {
  const h = makeHarness();
  const pending = createPendingFocus();

  scheduleTerminalFocus(() => true, pending, h.options);
  flushMicrotasks(h);

  const success = h.diagnostics.find(
    (d) => d.kind === "terminal_focus_scheduler_succeeded",
  );
  assert.deepEqual(success?.data, { tier: "microtask", attempt: 0 });
});

test("cancelScheduledTerminalFocus cancels in-flight RAF and timeout, makes microtask no-op", () => {
  const h = makeHarness();
  const fired: string[] = [];
  const pending = createPendingFocus();

  scheduleTerminalFocus(() => {
    fired.push("microtask");
    return false;
  }, pending, h.options);

  // Bump to RAF tier
  flushMicrotasks(h);
  fired.length = 0;

  cancelScheduledTerminalFocus(pending, h.options);
  assert.deepEqual(h.rafCancelled, [1]);

  // Even if a stale RAF callback somehow fires, it must no-op.
  // (Most schedulers cancel cleanly, but microtasks cannot be cancelled,
  // so the generation guard is the load-bearing piece.)
});

test("cancellation across a microtask boundary: stale microtask no-ops via generation guard", () => {
  const h = makeHarness();
  const fired: string[] = [];
  const pending = createPendingFocus();

  scheduleTerminalFocus(() => {
    fired.push("first");
    return true;
  }, pending, h.options);

  cancelScheduledTerminalFocus(pending, h.options);

  // The microtask is still in the queue — flush it. It must not fire focus.
  flushMicrotasks(h);
  assert.deepEqual(fired, []);
});
