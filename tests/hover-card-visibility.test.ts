import test from "node:test";
import assert from "node:assert/strict";

import {
  createHoverCardVisibilityState,
  scheduleHoverCardHide,
  shouldKeepHoverCardVisible,
} from "../src/components/hoverCardVisibility.ts";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("shouldKeepHoverCardVisible keeps cards visible while dragging", () => {
  assert.equal(
    shouldKeepHoverCardVisible({
      pinned: false,
      hovered: false,
      dragging: true,
    }),
    true,
  );
});

test("createHoverCardVisibilityState treats related card dragging as visible interaction", () => {
  assert.deepEqual(
    createHoverCardVisibilityState({
      pinned: false,
      hovered: false,
      draggingSelf: false,
      draggingRelated: true,
    }),
    {
      pinned: false,
      hovered: false,
      dragging: true,
    },
  );
});

test("scheduleHoverCardHide reads the latest state before hiding", async () => {
  const timeoutRef: { current: ReturnType<typeof setTimeout> | null } = {
    current: null,
  };
  let state = {
    pinned: false,
    hovered: false,
    dragging: false,
  };
  let hideCount = 0;

  scheduleHoverCardHide(timeoutRef, () => state, () => {
    hideCount += 1;
  }, 10);

  state = {
    pinned: false,
    hovered: false,
    dragging: true,
  };

  await wait(25);

  assert.equal(hideCount, 0);
});

test("scheduleHoverCardHide hides once the latest state no longer keeps the card visible", async () => {
  const timeoutRef: { current: ReturnType<typeof setTimeout> | null } = {
    current: null,
  };
  let hideCount = 0;

  scheduleHoverCardHide(
    timeoutRef,
    () => ({
      pinned: false,
      hovered: false,
      dragging: false,
    }),
    () => {
      hideCount += 1;
    },
    10,
  );

  await wait(25);

  assert.equal(hideCount, 1);
});
