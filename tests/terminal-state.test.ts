import test from "node:test";
import assert from "node:assert/strict";

import {
  getTerminalHeaderContextLabel,
  getTerminalDisplayTitle,
  normalizeTerminalCustomTitle,
  withToggledTerminalStarred,
  withUpdatedTerminalCustomTitle,
  withUpdatedTerminalType,
} from "../src/stores/terminalState.ts";
import type { TerminalData } from "../src/types/index.ts";

test("withUpdatedTerminalType preserves the existing span", () => {
  const terminal: TerminalData = {
    id: "terminal-1",
    title: "Terminal",
    type: "shell",
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    span: { cols: 1, rows: 1 },
  };

  const updated = withUpdatedTerminalType(terminal, "codex");

  assert.equal(updated.type, "codex");
  assert.deepEqual(updated.span, { cols: 1, rows: 1 });
});

test("normalizeTerminalCustomTitle trims input and clears blank values", () => {
  assert.equal(normalizeTerminalCustomTitle("  fix-auth  "), "fix-auth");
  assert.equal(normalizeTerminalCustomTitle("fix\n\n auth"), "fix auth");
  assert.equal(normalizeTerminalCustomTitle("   "), undefined);
});

test("withUpdatedTerminalCustomTitle stores a marker without replacing the base title", () => {
  const terminal: TerminalData = {
    id: "terminal-1",
    title: "Terminal",
    type: "shell",
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    span: { cols: 1, rows: 1 },
  };

  const updated = withUpdatedTerminalCustomTitle(terminal, "  fix-auth  ");

  assert.equal(updated.title, "Terminal");
  assert.equal(updated.customTitle, "fix-auth");
});

test("getTerminalDisplayTitle includes the custom marker when present", () => {
  const terminal: TerminalData = {
    id: "terminal-1",
    title: "Terminal",
    customTitle: "fix-auth",
    type: "shell",
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    span: { cols: 1, rows: 1 },
  };

  assert.equal(getTerminalDisplayTitle(terminal), "fix-auth · Terminal");
});

test("getTerminalHeaderContextLabel prefers the worktree branch label", () => {
  assert.equal(
    getTerminalHeaderContextLabel("feature/memory-layer", "codex"),
    "feature/memory-layer",
  );
});

test("getTerminalHeaderContextLabel falls back to the terminal title when no worktree label exists", () => {
  assert.equal(getTerminalHeaderContextLabel("", "Terminal"), "Terminal");
  assert.equal(getTerminalHeaderContextLabel("   ", "Codex"), "Codex");
});

test("withToggledTerminalStarred flips the terminal star state", () => {
  const terminal: TerminalData = {
    id: "terminal-1",
    title: "Codex",
    type: "codex",
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    span: { cols: 1, rows: 1 },
    starred: false,
  };

  const starred = withToggledTerminalStarred(terminal);
  assert.equal(starred.starred, true);

  const unstarred = withToggledTerminalStarred(starred);
  assert.equal(unstarred.starred, false);
});
