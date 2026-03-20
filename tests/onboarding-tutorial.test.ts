import test from "node:test";
import assert from "node:assert/strict";

type TutorialStep = 0 | 1 | 2 | 3 | 4;

interface TutorialState {
  step: TutorialStep;
  focusedIndex: number;
  switchCount: number;
  hasInteractedZoom: boolean;
}

const TERMINAL_COUNT = 4;

function initialState(): TutorialState {
  return {
    step: 0,
    focusedIndex: -1,
    switchCount: 0,
    hasInteractedZoom: false,
  };
}

function handleEnter(state: TutorialState): TutorialState {
  if (state.step === 0) {
    return { ...state, step: 1 };
  }

  if (state.step === 2 && state.switchCount >= 2) {
    return { ...state, step: 3 };
  }

  if (state.step === 3 && state.hasInteractedZoom) {
    return { ...state, step: 4 };
  }

  if (state.step === 4) {
    return state;
  }

  return state;
}

function handleFocus(state: TutorialState): TutorialState {
  if (state.step !== 1) {
    return state;
  }

  return { ...state, step: 2, focusedIndex: 0 };
}

function handleNextTerminal(state: TutorialState): TutorialState {
  if (state.step !== 2) {
    return state;
  }

  const next = (state.focusedIndex + 1) % TERMINAL_COUNT;
  return {
    ...state,
    focusedIndex: next,
    switchCount: state.switchCount + 1,
  };
}

function handlePrevTerminal(state: TutorialState): TutorialState {
  if (state.step !== 2) {
    return state;
  }

  const prev = (state.focusedIndex - 1 + TERMINAL_COUNT) % TERMINAL_COUNT;
  return {
    ...state,
    focusedIndex: prev,
    switchCount: state.switchCount + 1,
  };
}

function handleZoomOrPan(state: TutorialState): TutorialState {
  if (state.step !== 3) {
    return state;
  }

  return { ...state, hasInteractedZoom: true };
}

test("step 0 -> Enter advances to step 1", () => {
  const state = handleEnter(initialState());

  assert.equal(state.step, 1);
});

test("step 1 -> focus advances to step 2 with focusedIndex 0", () => {
  let state = initialState();
  state = handleEnter(state);
  state = handleFocus(state);

  assert.equal(state.step, 2);
  assert.equal(state.focusedIndex, 0);
});

test("step 2 -> next terminal wraps around (index 3 -> 0)", () => {
  const state = handleNextTerminal({
    step: 2,
    focusedIndex: 3,
    switchCount: 0,
    hasInteractedZoom: false,
  });

  assert.equal(state.focusedIndex, 0);
  assert.equal(state.switchCount, 1);
});

test("step 2 -> prev terminal wraps around (index 0 -> 3)", () => {
  const state = handlePrevTerminal({
    step: 2,
    focusedIndex: 0,
    switchCount: 0,
    hasInteractedZoom: false,
  });

  assert.equal(state.focusedIndex, 3);
  assert.equal(state.switchCount, 1);
});

test("step 2 -> Enter does nothing until switchCount >= 2", () => {
  const beforeReady: TutorialState = {
    step: 2,
    focusedIndex: 1,
    switchCount: 1,
    hasInteractedZoom: false,
  };
  const afterOneSwitch = handleEnter(beforeReady);
  const afterTwoSwitches = handleEnter({ ...beforeReady, switchCount: 2 });

  assert.equal(afterOneSwitch.step, 2);
  assert.equal(afterTwoSwitches.step, 3);
});

test("step 3 -> zoom interaction enables Enter to advance to step 4", () => {
  const start: TutorialState = {
    step: 3,
    focusedIndex: 1,
    switchCount: 2,
    hasInteractedZoom: false,
  };
  const beforeZoom = handleEnter(start);
  const afterZoom = handleZoomOrPan(start);
  const completed = handleEnter(afterZoom);

  assert.equal(beforeZoom.step, 3);
  assert.equal(afterZoom.hasInteractedZoom, true);
  assert.equal(completed.step, 4);
});

test("focus/switch/zoom actions are ignored on wrong steps", () => {
  const step0 = initialState();
  const step4: TutorialState = {
    step: 4,
    focusedIndex: 1,
    switchCount: 3,
    hasInteractedZoom: true,
  };

  assert.deepEqual(handleFocus(step0), step0);
  assert.deepEqual(handleNextTerminal(step0), step0);
  assert.deepEqual(handlePrevTerminal(step0), step0);
  assert.deepEqual(handleZoomOrPan(step0), step0);

  assert.deepEqual(handleFocus(step4), step4);
  assert.deepEqual(handleNextTerminal(step4), step4);
  assert.deepEqual(handlePrevTerminal(step4), step4);
  assert.deepEqual(handleZoomOrPan(step4), step4);
});
