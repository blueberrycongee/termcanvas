import test from "node:test";
import assert from "node:assert/strict";

import {
  cancelScheduledTerminalFocus,
  scheduleTerminalFocus,
} from "../src/terminal/focusScheduler.ts";

test("scheduleTerminalFocus defers focus until the next animation frame", () => {
  let focused = false;
  let queued: FrameRequestCallback | null = null;

  const pending = { current: null as number | null };
  scheduleTerminalFocus(
    () => {
      focused = true;
    },
    pending,
    (callback) => {
      queued = callback;
      return 1;
    },
    () => {},
  );

  assert.equal(focused, false);
  assert.equal(typeof queued, "function");

  queued?.(16);
  assert.equal(focused, true);
  assert.equal(pending.current, null);
});

test("scheduleTerminalFocus cancels the previous frame so only the latest focus runs", () => {
  const queued = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  const fired: string[] = [];

  let nextId = 1;
  const requestFrame = (callback: FrameRequestCallback) => {
    const id = nextId++;
    queued.set(id, callback);
    return id;
  };

  const cancelFrame = (id: number) => {
    cancelled.push(id);
    queued.delete(id);
  };

  const pending = { current: null as number | null };

  scheduleTerminalFocus(() => fired.push("first"), pending, requestFrame, cancelFrame);
  scheduleTerminalFocus(() => fired.push("second"), pending, requestFrame, cancelFrame);

  assert.deepEqual(cancelled, [1]);
  assert.equal(pending.current, 2);
  assert.equal(queued.has(1), false);
  assert.equal(queued.has(2), true);

  queued.get(2)?.(16);
  assert.deepEqual(fired, ["second"]);
  assert.equal(pending.current, null);
});

test("scheduleTerminalFocus lets xterm focus win after a same-turn competing focus update", () => {
  const queued = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  let activeTarget = "none";

  const pending = { current: null as number | null };
  const requestFrame = (callback: FrameRequestCallback) => {
    const id = nextId++;
    queued.set(id, callback);
    return id;
  };

  const syncFocus = () => {
    activeTarget = "xterm";
  };

  syncFocus();
  activeTarget = "other";
  assert.equal(activeTarget, "other");

  scheduleTerminalFocus(
    () => {
      activeTarget = "xterm";
    },
    pending,
    requestFrame,
    () => {},
  );

  activeTarget = "other";
  assert.equal(activeTarget, "other");

  queued.get(1)?.(16);
  assert.equal(activeTarget, "xterm");
  assert.equal(pending.current, null);
});

test("cancelScheduledTerminalFocus clears any queued focus frame", () => {
  const cancelled: number[] = [];
  const pending = { current: 7 as number | null };

  cancelScheduledTerminalFocus(pending, (id) => {
    cancelled.push(id);
  });

  assert.deepEqual(cancelled, [7]);
  assert.equal(pending.current, null);
});
