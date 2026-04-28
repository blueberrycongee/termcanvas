import test from "node:test";
import assert from "node:assert/strict";

import {
  DIAGNOSTICS_SNAPSHOT_SCHEMA_VERSION,
  buildIssueBody,
  buildSnapshot,
  type MainSnapshot,
  type RendererSnapshot,
} from "../shared/diagnostics-snapshot.ts";

function fakeMain(): MainSnapshot {
  return {
    app: {
      appVersion: "0.38.3",
      electronVersion: "41.2.1",
      chromiumVersion: "132.0.6834.83",
      nodeVersion: "20.18.1",
      platform: "darwin",
      arch: "arm64",
      locale: "en-US",
    },
    gpuFeatureStatus: {
      gpu_compositing: "enabled",
      webgl: "enabled",
    },
    displays: [
      {
        id: 1,
        scaleFactor: 2,
        rotation: 0,
        isPrimary: true,
        size: { width: 3024, height: 1964 },
      },
    ],
    window: {
      isVisible: true,
      isFocused: true,
      isMinimized: false,
      isFullScreen: false,
    },
    renderDiagnosticsLogPath: "/Users/x/Library/Application Support/.../log.jsonl",
  };
}

function fakeRenderer(): RendererSnapshot {
  return {
    visibilityState: "visible",
    documentFocused: true,
    devicePixelRatio: 2,
    innerWidth: 1440,
    innerHeight: 900,
    terminals: [
      {
        id: "term-uuid-1",
        rendererMode: "webgl",
        status: "running",
        mode: "attached",
        hasXterm: true,
        isAttached: true,
        isFocused: true,
        cols: 120,
        rows: 36,
      },
    ],
    webglPool: {
      poolSize: 1,
      maxContexts: 16,
      focusedTerminalId: "term-uuid-1",
      trackedTerminalIds: ["term-uuid-1"],
      contextLossCount: 0,
      lastContextLossAt: null,
    },
  };
}

test("buildSnapshot stamps schema version and captured_at", () => {
  const snap = buildSnapshot(
    fakeMain(),
    fakeRenderer(),
    () => "2026-04-28T10:00:00.000Z",
  );
  assert.equal(snap.schema_version, DIAGNOSTICS_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(snap.captured_at, "2026-04-28T10:00:00.000Z");
});

test("buildIssueBody includes app, GPU, window, terminal sections", () => {
  const snap = buildSnapshot(fakeMain(), fakeRenderer());
  const body = buildIssueBody(snap);
  assert.match(body, /app: 0\.38\.3/);
  assert.match(body, /electron: 41\.2\.1/);
  assert.match(body, /gpu_compositing: enabled/);
  assert.match(body, /display 1: 3024x1964 @2x/);
  assert.match(
    body,
    /term-uuid-1 renderer=webgl status=running mode=attached attached=true focused=true xterm=true size=120x36/,
  );
  assert.match(body, /webgl pool: 1\/16 focused=term-uuid-1/);
});

test("buildIssueBody does not leak privacy-sensitive content", () => {
  // The schema's value here: by design, the body cannot contain titles,
  // labels, paths beyond the documented log file path, or PTY content.
  // This test exercises that nothing in the formatter accidentally accepts
  // a label-shaped field. Even if a future caller tried to inject one
  // through a non-existent property on the snapshot, the formatter only
  // reads the typed allowlist and drops anything else.
  const snap = buildSnapshot(fakeMain(), {
    ...fakeRenderer(),
    // @ts-expect-error - simulate a stray field someone might add later
    leakedTitle: "~/work/secret-project",
  });
  const body = buildIssueBody(snap);
  assert.doesNotMatch(body, /secret-project/);
  assert.doesNotMatch(body, /leakedTitle/);
});

test("buildIssueBody renders empty terminals state", () => {
  const renderer = fakeRenderer();
  renderer.terminals = [];
  const snap = buildSnapshot(fakeMain(), renderer);
  const body = buildIssueBody(snap);
  assert.match(body, /\(no terminals\)/);
});
