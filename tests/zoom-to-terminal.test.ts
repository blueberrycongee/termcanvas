import test from "node:test";
import assert from "node:assert/strict";

import { zoomToTerminal } from "../src/utils/zoomToTerminal.ts";
import { panToTerminal } from "../src/utils/panToTerminal.ts";
import { panToWorktree } from "../src/utils/panToWorktree.ts";
import { useProjectStore } from "../src/stores/projectStore.ts";
import { useCanvasStore } from "../src/stores/canvasStore.ts";
import { usePreferencesStore } from "../src/stores/preferencesStore.ts";
import {
  computeWorktreeSize,
  packTerminals,
  PROJ_PAD,
  PROJ_TITLE_H,
  WT_PAD,
  WT_TITLE_H,
} from "../src/layout.ts";
import type { ProjectData } from "../src/types/index.ts";

function createProjects(): ProjectData[] {
  return [
    {
      id: "project-1",
      name: "Project One",
      path: "/tmp/project-1",
      position: { x: 120, y: 40 },
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
              id: "terminal-a",
              title: "Terminal A",
              type: "shell",
              minimized: false,
              focused: true,
              ptyId: null,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
            {
              id: "terminal-b",
              title: "Terminal B",
              type: "shell",
              minimized: false,
              focused: false,
              ptyId: null,
              status: "idle",
              span: { cols: 2, rows: 1 },
            },
          ],
        },
      ],
    },
  ];
}

function withWindowSize(width: number, height: number, run: () => void) {
  const previousWindow = (globalThis as { window?: Window }).window;
  (globalThis as { window?: Window }).window = {
    innerWidth: width,
    innerHeight: height,
    dispatchEvent: () => true,
  } as unknown as Window;

  try {
    run();
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = previousWindow;
    }
  }
}

function getExpectedTerminalViewportTarget(
  width: number,
  height: number,
  terminalId: string,
) {
  const project = createProjects()[0];
  const worktree = project.worktrees[0];
  const terminalIndex = worktree.terminals.findIndex((t) => t.id === terminalId);
  assert.notEqual(terminalIndex, -1);

  const item = packTerminals(worktree.terminals.map((t) => t.span))[terminalIndex];
  assert.ok(item);

  const rightOffset = 32;
  const padding = 60;
  const viewW = width - rightOffset - padding * 2;
  const viewH = height - padding * 2;
  const scale = Math.min(viewW / item.w, viewH / item.h) * 0.85;

  const absX =
    project.position.x + PROJ_PAD + worktree.position.x + WT_PAD + item.x;
  const absY =
    project.position.y +
    PROJ_TITLE_H +
    PROJ_PAD +
    worktree.position.y +
    WT_TITLE_H +
    WT_PAD +
    item.y;

  return {
    x: -(absX + item.w / 2) * scale + (width - rightOffset) / 2,
    y: -(absY + item.h / 2) * scale + height / 2,
    scale,
  };
}

function getExpectedWorktreeViewportTarget(width: number, height: number) {
  const project = createProjects()[0];
  const worktree = project.worktrees[0];
  const size = computeWorktreeSize(worktree.terminals.map((t) => t.span));
  const rightOffset = 32;
  const padding = 60;
  const viewW = width - rightOffset - padding * 2;
  const viewH = height - padding * 2;
  const scale = Math.min(viewW / size.w, viewH / size.h) * 0.85;

  const absX = project.position.x + PROJ_PAD + worktree.position.x;
  const absY =
    project.position.y + PROJ_TITLE_H + PROJ_PAD + worktree.position.y;

  return {
    x: -(absX + size.w / 2) * scale + (width - rightOffset) / 2,
    y: -(absY + size.h / 2) * scale + height / 2,
    scale,
  };
}

test("zoomToTerminal can focus the target terminal before animating", () => {
  const previousPreferences = usePreferencesStore.getState();
  const previousCanvasState = useCanvasStore.getState();
  const previousProjectState = useProjectStore.getState();
  const animateCalls: Array<{ x: number; y: number; scale: number | undefined }> = [];

  try {
    usePreferencesStore.setState({ composerEnabled: false });
    useProjectStore.setState({
      projects: createProjects(),
      focusedProjectId: "project-1",
      focusedWorktreeId: "worktree-1",
    });
    useCanvasStore.setState({
      viewport: { x: 0, y: 0, scale: 1 },
      rightPanelCollapsed: true,
      animateTo: (x, y, scale) => {
        animateCalls.push({ x, y, scale });
      },
    });

    withWindowSize(1440, 900, () => {
      zoomToTerminal("project-1", "worktree-1", "terminal-b", { focus: true });
    });

    const expected = getExpectedTerminalViewportTarget(
      1440,
      900,
      "terminal-b",
    );

    const terminals =
      useProjectStore.getState().projects[0].worktrees[0].terminals;
    assert.equal(terminals[0].focused, false);
    assert.equal(terminals[1].focused, true);
    assert.equal(animateCalls.length, 1);
    assert.equal(animateCalls[0].x, expected.x);
    assert.equal(animateCalls[0].y, expected.y);
    assert.equal(animateCalls[0].scale, expected.scale);
  } finally {
    usePreferencesStore.setState(previousPreferences);
    useCanvasStore.setState(previousCanvasState);
    useProjectStore.setState(previousProjectState);
  }
});

test("panToTerminal animates to main viewport target", () => {
  const previousCanvasState = useCanvasStore.getState();
  const previousProjectState = useProjectStore.getState();
  const animateCalls: Array<{ x: number; y: number; scale: number | undefined }> = [];

  try {
    useProjectStore.setState({
      projects: createProjects(),
      focusedProjectId: "project-1",
      focusedWorktreeId: "worktree-1",
    });
    useCanvasStore.setState({
      viewport: { x: 0, y: 0, scale: 1 },
      rightPanelCollapsed: true,
      animateTo: (x, y, scale) => {
        animateCalls.push({ x, y, scale });
      },
    });

    withWindowSize(1440, 900, () => {
      panToTerminal("terminal-b");
    });

    const expected = getExpectedTerminalViewportTarget(
      1440,
      900,
      "terminal-b",
    );

    assert.equal(animateCalls.length, 1);
    assert.equal(animateCalls[0].x, expected.x);
    assert.equal(animateCalls[0].y, expected.y);
    assert.equal(animateCalls[0].scale, expected.scale);
    assert.equal(
      useProjectStore.getState().projects[0].worktrees[0].terminals[1].focused,
      true,
    );
  } finally {
    useCanvasStore.setState(previousCanvasState);
    useProjectStore.setState(previousProjectState);
  }
});

test("panToWorktree animates to main viewport target", () => {
  const previousCanvasState = useCanvasStore.getState();
  const previousProjectState = useProjectStore.getState();
  const animateCalls: Array<{ x: number; y: number; scale: number | undefined }> = [];

  try {
    useProjectStore.setState({
      projects: createProjects(),
      focusedProjectId: "project-1",
      focusedWorktreeId: "worktree-1",
    });
    useCanvasStore.setState({
      viewport: { x: 0, y: 0, scale: 1 },
      rightPanelCollapsed: true,
      animateTo: (x, y, scale) => {
        animateCalls.push({ x, y, scale });
      },
    });

    withWindowSize(1440, 900, () => {
      panToWorktree("project-1", "worktree-1");
    });

    const expected = getExpectedWorktreeViewportTarget(1440, 900);

    assert.equal(animateCalls.length, 1);
    assert.equal(animateCalls[0].x, expected.x);
    assert.equal(animateCalls[0].y, expected.y);
    assert.equal(animateCalls[0].scale, expected.scale);
  } finally {
    useCanvasStore.setState(previousCanvasState);
    useProjectStore.setState(previousProjectState);
  }
});
