import test from "node:test";
import assert from "node:assert/strict";

import { zoomToTerminal } from "../src/utils/zoomToTerminal.ts";
import { useProjectStore } from "../src/stores/projectStore.ts";
import { useCanvasStore } from "../src/stores/canvasStore.ts";
import { usePreferencesStore } from "../src/stores/preferencesStore.ts";
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

    const terminals =
      useProjectStore.getState().projects[0].worktrees[0].terminals;
    assert.equal(terminals[0].focused, false);
    assert.equal(terminals[1].focused, true);
    assert.equal(animateCalls.length, 1);
    assert.ok(typeof animateCalls[0].x === "number");
    assert.ok(typeof animateCalls[0].y === "number");
    assert.ok(typeof animateCalls[0].scale === "number");
  } finally {
    usePreferencesStore.setState(previousPreferences);
    useCanvasStore.setState(previousCanvasState);
    useProjectStore.setState(previousProjectState);
  }
});
