import test from "node:test";
import assert from "node:assert/strict";

// preferencesStore writes through localStorage on every setter. Stub a
// minimal in-memory shim before importing the store so the side-effect
// path doesn't blow up under Node test runner.
const memoryStore = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k) => memoryStore.get(k) ?? null,
  setItem: (k, v) => {
    memoryStore.set(k, String(v));
  },
  removeItem: (k) => {
    memoryStore.delete(k);
  },
  clear: () => memoryStore.clear(),
  key: (i) => [...memoryStore.keys()][i] ?? null,
  get length() {
    return memoryStore.size;
  },
} as Storage;
(globalThis as { window?: Partial<Window> & { termcanvas?: unknown } }).window =
  (globalThis as { window?: Partial<Window> }).window ?? {};

import { usePreferencesStore } from "../src/stores/preferencesStore.ts";

test("setGpuAcceleration on -> terminalRenderer mirrors as webgl", () => {
  usePreferencesStore.getState().setGpuAcceleration("on");
  assert.equal(usePreferencesStore.getState().gpuAcceleration, "on");
  assert.equal(usePreferencesStore.getState().terminalRenderer, "webgl");
});

test("setGpuAcceleration auto -> terminalRenderer mirrors as webgl", () => {
  usePreferencesStore.getState().setGpuAcceleration("auto");
  assert.equal(usePreferencesStore.getState().gpuAcceleration, "auto");
  assert.equal(usePreferencesStore.getState().terminalRenderer, "webgl");
});

test("setGpuAcceleration off -> terminalRenderer mirrors as dom", () => {
  usePreferencesStore.getState().setGpuAcceleration("off");
  assert.equal(usePreferencesStore.getState().gpuAcceleration, "off");
  assert.equal(usePreferencesStore.getState().terminalRenderer, "dom");
});

test("legacy setTerminalRenderer dom -> gpuAcceleration is off", () => {
  usePreferencesStore.getState().setTerminalRenderer("dom");
  assert.equal(usePreferencesStore.getState().gpuAcceleration, "off");
  assert.equal(usePreferencesStore.getState().terminalRenderer, "dom");
});

test("legacy setTerminalRenderer webgl -> gpuAcceleration is auto (not 'on')", () => {
  usePreferencesStore.getState().setTerminalRenderer("dom");
  usePreferencesStore.getState().setTerminalRenderer("webgl");
  // Selecting webgl through the legacy toggle implies "I want WebGL"
  // but doesn't imply "and override demotion" — auto is the safer
  // default, matching the new pref's intent.
  assert.equal(usePreferencesStore.getState().gpuAcceleration, "auto");
  assert.equal(usePreferencesStore.getState().terminalRenderer, "webgl");
});
