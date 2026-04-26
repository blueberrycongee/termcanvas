import test from "node:test";
import assert from "node:assert/strict";

import { usePinStore } from "../src/stores/pinStore.ts";
import type { Pin } from "../src/types/index.ts";

function makePin(overrides: Partial<Pin> & { id: string; repo: string; title: string }): Pin {
  return {
    id: overrides.id,
    title: overrides.title,
    status: overrides.status ?? "open",
    repo: overrides.repo,
    body: overrides.body ?? "",
    links: overrides.links ?? [],
    created: overrides.created ?? "2026-01-01T00:00:00Z",
    updated: overrides.updated ?? "2026-01-01T00:00:00Z",
  };
}

function resetPinStore() {
  usePinStore.setState({
    pinsByProject: {},
    openProjectPath: null,
    openDetailPinId: null,
    composingForPin: null,
    terminalPinMap: {},
    showCompleted: false,
  });
}

test("assignPinToTerminal sets the entry; clearTerminalAssignment removes it", () => {
  resetPinStore();
  const pin = makePin({ id: "pin-a", repo: "/repo", title: "First" });

  usePinStore.getState().assignPinToTerminal("term-1", pin);
  assert.deepEqual(usePinStore.getState().terminalPinMap, {
    "term-1": { pinId: "pin-a", repo: "/repo", title: "First" },
  });

  usePinStore.getState().clearTerminalAssignment("term-1");
  assert.deepEqual(usePinStore.getState().terminalPinMap, {});
});

test("assigning a different pin to the same terminal replaces (no accumulation)", () => {
  resetPinStore();
  const a = makePin({ id: "pin-a", repo: "/repo", title: "First" });
  const b = makePin({ id: "pin-b", repo: "/repo", title: "Second" });

  usePinStore.getState().assignPinToTerminal("term-1", a);
  usePinStore.getState().assignPinToTerminal("term-1", b);

  assert.deepEqual(usePinStore.getState().terminalPinMap, {
    "term-1": { pinId: "pin-b", repo: "/repo", title: "Second" },
  });
});

test("removePin clears any matching terminal assignment", () => {
  resetPinStore();
  const pin = makePin({ id: "pin-a", repo: "/repo", title: "Linked" });
  usePinStore.setState({ pinsByProject: { "/repo": [pin] } });
  usePinStore.getState().assignPinToTerminal("term-1", pin);
  usePinStore.getState().assignPinToTerminal("term-2", pin);

  usePinStore.getState().removePin("/repo", "pin-a");

  assert.deepEqual(usePinStore.getState().terminalPinMap, {});
  assert.equal(
    usePinStore.getState().pinsByProject["/repo"].find((t) => t.id === "pin-a"),
    undefined,
  );
});

test("upsertPin refreshes cached title on existing terminal assignments", () => {
  resetPinStore();
  const initial = makePin({ id: "pin-a", repo: "/repo", title: "Original" });
  usePinStore.setState({ pinsByProject: { "/repo": [initial] } });
  usePinStore.getState().assignPinToTerminal("term-1", initial);

  const renamed = makePin({ id: "pin-a", repo: "/repo", title: "Renamed" });
  usePinStore.getState().upsertPin("/repo", renamed);

  assert.equal(
    usePinStore.getState().terminalPinMap["term-1"].title,
    "Renamed",
  );
});

test("upsertPin leaves terminalPinMap reference stable when title is unchanged", () => {
  resetPinStore();
  const pin = makePin({ id: "pin-a", repo: "/repo", title: "Same" });
  usePinStore.setState({ pinsByProject: { "/repo": [pin] } });
  usePinStore.getState().assignPinToTerminal("term-1", pin);
  const before = usePinStore.getState().terminalPinMap;

  // Body change but same title → terminalPinMap should not be re-allocated.
  usePinStore.getState().upsertPin(
    "/repo",
    makePin({ id: "pin-a", repo: "/repo", title: "Same", body: "edited" }),
  );

  assert.equal(usePinStore.getState().terminalPinMap, before);
});

test("toggleShowCompleted flips the boolean; setShowCompleted assigns directly", () => {
  resetPinStore();
  assert.equal(usePinStore.getState().showCompleted, false);

  usePinStore.getState().toggleShowCompleted();
  assert.equal(usePinStore.getState().showCompleted, true);

  usePinStore.getState().toggleShowCompleted();
  assert.equal(usePinStore.getState().showCompleted, false);

  usePinStore.getState().setShowCompleted(true);
  assert.equal(usePinStore.getState().showCompleted, true);
});
