import test from "node:test";
import assert from "node:assert/strict";

function installSelectionActionGlobals() {
  const storage = new Map<string, string>();
  const navigator = {
    language: "en-US",
    userAgent: "node-test",
    clipboard: {
      writeText: async () => {},
    },
  };
  const target = new EventTarget();
  const mockWindow = Object.assign(target, {
    navigator,
    termcanvas: undefined as unknown,
  }) as Window & { termcanvas: unknown };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      clear() {
        storage.clear();
      },
    },
  });

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: navigator,
  });

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: mockWindow,
  });
}

test("activateProjectInScene clears terminal/worktree focus and selects the project", async () => {
  installSelectionActionGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { useSelectionStore } = await import("../src/stores/selectionStore.ts");
  const { activateProjectInScene } = await import(
    "../src/actions/sceneSelectionActions.ts"
  );

  const previousProjectState = useProjectStore.getState();
  const previousSelectionState = useSelectionStore.getState();

  try {
    useProjectStore.setState({
      focusedProjectId: "project-1",
      focusedWorktreeId: "worktree-1",
      projects: [
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
                  title: "Terminal",
                  type: "shell",
                  minimized: false,
                  focused: true,
                  ptyId: null,
                  status: "idle",
                  span: { cols: 1, rows: 1 },
                },
              ],
            },
          ],
        },
        {
          id: "project-2",
          name: "Project Two",
          path: "/tmp/project-2",
          position: { x: 500, y: 0 },
          collapsed: false,
          zIndex: 2,
          worktrees: [
            {
              id: "worktree-2",
              name: "main",
              path: "/tmp/project-2",
              position: { x: 0, y: 0 },
              collapsed: false,
              terminals: [],
            },
          ],
        },
      ],
    });
    useSelectionStore.setState({
      selectedItems: [
        {
          type: "terminal",
          projectId: "project-1",
          worktreeId: "worktree-1",
          terminalId: "terminal-1",
        },
      ],
      selectionRect: null,
    });

    activateProjectInScene("project-2", { bringToFront: true });

    const state = useProjectStore.getState();
    assert.equal(state.focusedProjectId, null);
    assert.equal(state.focusedWorktreeId, null);
    assert.equal(
      state.projects[0].worktrees[0].terminals[0]?.focused ?? false,
      false,
    );
    assert.deepEqual(useSelectionStore.getState().selectedItems, [
      {
        type: "project",
        projectId: "project-2",
      },
    ]);
    assert.ok((state.projects[1].zIndex ?? 0) >= (state.projects[0].zIndex ?? 0));
  } finally {
    useProjectStore.setState(previousProjectState);
    useSelectionStore.setState(previousSelectionState);
  }
});

test("activateWorktreeInScene and activateTerminalInScene keep selection and focus in sync", async () => {
  installSelectionActionGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { useSelectionStore } = await import("../src/stores/selectionStore.ts");
  const {
    activateTerminalInScene,
    activateWorktreeInScene,
    clearSceneFocusAndSelection,
  } = await import("../src/actions/sceneSelectionActions.ts");

  const previousProjectState = useProjectStore.getState();
  const previousSelectionState = useSelectionStore.getState();

  try {
    useProjectStore.setState({
      focusedProjectId: null,
      focusedWorktreeId: null,
      projects: [
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
                  title: "Terminal",
                  type: "shell",
                  minimized: false,
                  focused: false,
                  ptyId: null,
                  status: "idle",
                  span: { cols: 1, rows: 1 },
                },
              ],
            },
          ],
        },
      ],
    });
    useSelectionStore.setState({
      selectedItems: [],
      selectionRect: null,
    });

    activateWorktreeInScene("project-1", "worktree-1");
    assert.equal(useProjectStore.getState().focusedProjectId, "project-1");
    assert.equal(useProjectStore.getState().focusedWorktreeId, "worktree-1");
    assert.deepEqual(useSelectionStore.getState().selectedItems, [
      {
        type: "worktree",
        projectId: "project-1",
        worktreeId: "worktree-1",
      },
    ]);

    activateTerminalInScene("project-1", "worktree-1", "terminal-1", {
      focusComposer: false,
    });
    assert.equal(useProjectStore.getState().focusedProjectId, "project-1");
    assert.equal(useProjectStore.getState().focusedWorktreeId, "worktree-1");
    assert.equal(
      useProjectStore.getState().projects[0].worktrees[0].terminals[0]?.focused,
      true,
    );
    assert.deepEqual(useSelectionStore.getState().selectedItems, [
      {
        type: "terminal",
        projectId: "project-1",
        worktreeId: "worktree-1",
        terminalId: "terminal-1",
      },
    ]);

    clearSceneFocusAndSelection();
    assert.equal(useProjectStore.getState().focusedProjectId, null);
    assert.equal(useProjectStore.getState().focusedWorktreeId, null);
    assert.deepEqual(useSelectionStore.getState().selectedItems, []);
  } finally {
    useProjectStore.setState(previousProjectState);
    useSelectionStore.setState(previousSelectionState);
  }
});

test("activateCardInScene clears focus and selects the card", async () => {
  installSelectionActionGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { useSelectionStore } = await import("../src/stores/selectionStore.ts");
  const { activateCardInScene } = await import(
    "../src/actions/sceneSelectionActions.ts"
  );

  const previousProjectState = useProjectStore.getState();
  const previousSelectionState = useSelectionStore.getState();

  try {
    useProjectStore.setState({
      focusedProjectId: "project-1",
      focusedWorktreeId: "worktree-1",
      projects: [
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
                  title: "Terminal",
                  type: "shell",
                  minimized: false,
                  focused: true,
                  ptyId: null,
                  status: "idle",
                  span: { cols: 1, rows: 1 },
                },
              ],
            },
          ],
        },
      ],
    });
    useSelectionStore.setState({
      selectedItems: [],
      selectionRect: null,
    });

    activateCardInScene("browser:card-1");

    assert.equal(useProjectStore.getState().focusedProjectId, null);
    assert.equal(useProjectStore.getState().focusedWorktreeId, null);
    assert.equal(
      useProjectStore.getState().projects[0].worktrees[0].terminals[0]?.focused,
      false,
    );
    assert.deepEqual(useSelectionStore.getState().selectedItems, [
      {
        type: "card",
        cardId: "browser:card-1",
      },
    ]);
  } finally {
    useProjectStore.setState(previousProjectState);
    useSelectionStore.setState(previousSelectionState);
  }
});

test("activateAnnotationInScene clears focus and selects the annotation", async () => {
  installSelectionActionGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { useSelectionStore } = await import("../src/stores/selectionStore.ts");
  const { activateAnnotationInScene } = await import(
    "../src/actions/sceneSelectionActions.ts"
  );

  const previousProjectState = useProjectStore.getState();
  const previousSelectionState = useSelectionStore.getState();

  try {
    useProjectStore.setState({
      focusedProjectId: "project-1",
      focusedWorktreeId: "worktree-1",
      projects: [
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
                  title: "Terminal",
                  type: "shell",
                  minimized: false,
                  focused: true,
                  ptyId: null,
                  status: "idle",
                  span: { cols: 1, rows: 1 },
                },
              ],
            },
          ],
        },
      ],
    });
    useSelectionStore.setState({
      selectedItems: [],
      selectionRect: null,
    });

    activateAnnotationInScene("annotation-1");

    assert.equal(useProjectStore.getState().focusedProjectId, null);
    assert.equal(useProjectStore.getState().focusedWorktreeId, null);
    assert.equal(
      useProjectStore.getState().projects[0].worktrees[0].terminals[0]?.focused,
      false,
    );
    assert.deepEqual(useSelectionStore.getState().selectedItems, [
      {
        type: "annotation",
        annotationId: "annotation-1",
      },
    ]);
  } finally {
    useProjectStore.setState(previousProjectState);
    useSelectionStore.setState(previousSelectionState);
  }
});
