import test from "node:test";
import assert from "node:assert/strict";

import { useUpdaterStore } from "../src/stores/updaterStore.ts";

function resetUpdaterStore() {
  useUpdaterStore.setState({
    status: "idle",
    info: null,
    downloadPercent: 0,
    errorMessage: null,
    installOnCloseRequested: false,
  });
}

test("pending restart install request is consumed exactly once", () => {
  resetUpdaterStore();

  const store = useUpdaterStore.getState();

  assert.equal(store.consumeRestartOnClose(), false);

  store.requestRestartOnClose();
  assert.equal(useUpdaterStore.getState().installOnCloseRequested, true);

  assert.equal(useUpdaterStore.getState().consumeRestartOnClose(), true);
  assert.equal(useUpdaterStore.getState().installOnCloseRequested, false);
  assert.equal(useUpdaterStore.getState().consumeRestartOnClose(), false);
});

test("canceling a pending restart request clears the close intent", () => {
  resetUpdaterStore();

  const store = useUpdaterStore.getState();
  store.requestRestartOnClose();
  store.cancelRestartOnClose();

  assert.equal(useUpdaterStore.getState().installOnCloseRequested, false);
  assert.equal(useUpdaterStore.getState().consumeRestartOnClose(), false);
});
