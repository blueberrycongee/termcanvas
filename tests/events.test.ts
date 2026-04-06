import test from "node:test";
import assert from "node:assert/strict";

import { createTypedEventBus } from "../src/events.ts";

test("typed event bus delivers payloads and supports unsubscribe", () => {
  const bus = createTypedEventBus<{
    "terminal:focus": { terminalId: string };
  }>();
  const received: string[] = [];

  const removeListener = bus.on("terminal:focus", ({ terminalId }) => {
    received.push(terminalId);
  });

  bus.emit("terminal:focus", { terminalId: "terminal-1" });
  removeListener();
  bus.emit("terminal:focus", { terminalId: "terminal-2" });

  assert.deepEqual(received, ["terminal-1"]);
});

test("typed event bus supports undefined payload events", () => {
  const bus = createTypedEventBus<{
    "composer:focus": undefined;
  }>();
  let count = 0;

  bus.on("composer:focus", () => {
    count += 1;
  });

  bus.emit("composer:focus");

  assert.equal(count, 1);
});
