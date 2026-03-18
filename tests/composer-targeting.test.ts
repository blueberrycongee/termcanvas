import test from "node:test";
import assert from "node:assert/strict";

import {
  getComposerTargetState,
  getSupportedTerminals,
  resolveComposerTarget,
} from "../src/components/composerTarget.ts";
import type { ProjectData } from "../src/types/index.ts";

function createProjects(): ProjectData[] {
  return [
    {
      id: "project-1",
      name: "Project One",
      path: "/tmp/project-1",
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 1,
      worktrees: [
        {
          id: "worktree-1",
          name: "main",
          path: "/tmp/project-1",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [
            {
              id: "terminal-1",
              title: "Terminal 1",
              type: "claude",
              minimized: false,
              focused: false,
              ptyId: 101,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
            {
              id: "terminal-2",
              title: "Terminal 2",
              type: "codex",
              minimized: false,
              focused: false,
              ptyId: 102,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
          ],
        },
      ],
    },
  ];
}

test("composer has no target when terminals exist but none is focused", () => {
  const supportedTerminals = getSupportedTerminals(createProjects(), () => true);

  const target = resolveComposerTarget(supportedTerminals);

  assert.equal(target, null);
});

test("composer uses the focused terminal as target", () => {
  const projects = createProjects();
  projects[0].worktrees[0].terminals[1].focused = true;
  const supportedTerminals = getSupportedTerminals(projects, () => true);

  const target = resolveComposerTarget(supportedTerminals);

  assert.equal(target?.terminalId, "terminal-2");
});

test("composer enters no-target state when terminals exist but none is focused", () => {
  const supportedTerminals = getSupportedTerminals(createProjects(), () => true);

  const targetState = getComposerTargetState(supportedTerminals, null);

  assert.equal(targetState, "no-target");
});

test("composer enters empty state when there are no supported terminals", () => {
  const targetState = getComposerTargetState([], null);

  assert.equal(targetState, "empty");
});

test("composer enters ready state when a focused terminal exists", () => {
  const projects = createProjects();
  projects[0].worktrees[0].terminals[0].focused = true;
  const supportedTerminals = getSupportedTerminals(projects, () => true);
  const target = resolveComposerTarget(supportedTerminals);

  const targetState = getComposerTargetState(supportedTerminals, target);

  assert.equal(targetState, "ready");
});
