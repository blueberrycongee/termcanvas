import test from "node:test";
import assert from "node:assert/strict";

import {
  derivePublicTerminalStatus,
  hydrateLifecycleFromPublicStatus,
  IDLE_LIFECYCLE_STATE,
  transitionLifecycle,
} from "../src/terminal/terminalLifecycle.ts";

test("spawn lifecycle keeps spawning internal while exposing idle publicly", () => {
  const spawning = transitionLifecycle(IDLE_LIFECYCLE_STATE, {
    type: "spawn_requested",
  });

  assert.equal(spawning.processPhase, "spawning");
  assert.equal(derivePublicTerminalStatus(spawning), "idle");

  const running = transitionLifecycle(spawning, { type: "spawn_succeeded" });
  assert.equal(running.processPhase, "running");
  assert.equal(derivePublicTerminalStatus(running), "running");
});

test("output and waiting timeout transition through active and waiting", () => {
  const running = hydrateLifecycleFromPublicStatus("running");
  const active = transitionLifecycle(running, { type: "output_received" });
  const waiting = transitionLifecycle(active, { type: "waiting_timeout" });

  assert.equal(derivePublicTerminalStatus(active), "active");
  assert.equal(derivePublicTerminalStatus(waiting), "waiting");
});

test("turn completion only applies while a running terminal is active or waiting", () => {
  const completedFromActive = transitionLifecycle(
    transitionLifecycle(hydrateLifecycleFromPublicStatus("running"), {
      type: "output_received",
    }),
    { type: "turn_completed" },
  );

  assert.equal(derivePublicTerminalStatus(completedFromActive), "completed");

  assert.throws(() =>
    transitionLifecycle(hydrateLifecycleFromPublicStatus("idle"), {
      type: "turn_completed",
    }),
  );
});

test("process exits map to success and error public statuses", () => {
  const active = transitionLifecycle(hydrateLifecycleFromPublicStatus("running"), {
    type: "output_received",
  });

  const success = transitionLifecycle(active, { type: "process_exited_success" });
  const failure = transitionLifecycle(active, { type: "process_exited_error" });

  assert.equal(derivePublicTerminalStatus(success), "success");
  assert.equal(derivePublicTerminalStatus(failure), "error");
});

test("hook failure surfaces an error but later output recovers to active", () => {
  const active = transitionLifecycle(hydrateLifecycleFromPublicStatus("running"), {
    type: "output_received",
  });
  const failed = transitionLifecycle(active, { type: "hook_failed" });
  const recovered = transitionLifecycle(failed, { type: "output_received" });

  assert.equal(derivePublicTerminalStatus(failed), "error");
  assert.equal(derivePublicTerminalStatus(recovered), "active");
});

test("hydrating a public error preserves a recoverable running error state", () => {
  const hydrated = hydrateLifecycleFromPublicStatus("error");
  const recovered = transitionLifecycle(hydrated, { type: "output_received" });

  assert.equal(hydrated.processPhase, "running");
  assert.equal(hydrated.exitKind, "error");
  assert.equal(derivePublicTerminalStatus(hydrated), "error");
  assert.equal(derivePublicTerminalStatus(recovered), "active");
});

test("destroy_requested marks the lifecycle as a killed exit while keeping public compatibility", () => {
  const active = transitionLifecycle(hydrateLifecycleFromPublicStatus("running"), {
    type: "output_received",
  });
  const destroyed = transitionLifecycle(active, { type: "destroy_requested" });

  assert.equal(destroyed.processPhase, "exited");
  assert.equal(destroyed.exitKind, "killed");
  assert.equal(derivePublicTerminalStatus(destroyed), "error");
});
