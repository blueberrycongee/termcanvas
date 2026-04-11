import test from "node:test";
import assert from "node:assert/strict";
import { CLI_LAUNCH } from "../../headless-runtime/terminal-launch.ts";

// These tests pin the wire-level CLI flags each adapter emits. If a CLI
// renames its flags upstream, this is the place that catches it before a
// dispatched worker silently launches with the wrong arguments.

test("claude adapter advertises model support and emits --model <name>", () => {
  const adapter = CLI_LAUNCH.claude;
  assert.ok(adapter, "claude adapter must exist");
  assert.equal(adapter!.shell, "claude");
  assert.equal(adapter!.supportsModel(), true);
  assert.deepEqual(adapter!.modelArgs("opus"), ["--model", "opus"]);
});

test("codex adapter advertises model support and emits -m <name>", () => {
  const adapter = CLI_LAUNCH.codex;
  assert.ok(adapter, "codex adapter must exist");
  assert.equal(adapter!.shell, "codex");
  assert.equal(adapter!.supportsModel(), true);
  assert.deepEqual(adapter!.modelArgs("gpt-5"), ["-m", "gpt-5"]);
});

test("claude adapter emits resume args; codex returns empty", () => {
  assert.deepEqual(CLI_LAUNCH.claude!.resumeArgs("session-abc"), ["--resume", "session-abc"]);
  assert.deepEqual(CLI_LAUNCH.codex!.resumeArgs("session-abc"), []);
});

test("non-Hydra terminal types do not advertise model support", () => {
  for (const type of ["gemini", "lazygit", "tmux", "opencode"] as const) {
    const adapter = CLI_LAUNCH[type];
    assert.ok(adapter, `${type} adapter must exist`);
    assert.equal(adapter!.supportsModel(), false, `${type} should not support model selection`);
    assert.deepEqual(adapter!.modelArgs("anything"), []);
  }
});
