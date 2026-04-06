import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectContainer } from "../src/containers/ProjectContainer.tsx";
import { useLocaleStore } from "../src/stores/localeStore.ts";
import { useProjectStore } from "../src/stores/projectStore.ts";
import { useSelectionStore } from "../src/stores/selectionStore.ts";
import { useTileDimensionsStore } from "../src/stores/tileDimensionsStore.ts";
import type { ProjectData } from "../shared/runtime-types.ts";

const initialLocaleState = useLocaleStore.getState();
const initialProjectState = useProjectStore.getState();
const initialSelectionState = useSelectionStore.getState();
const initialTileState = useTileDimensionsStore.getState();

function makeProject(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    id: "project-1",
    name: "Project One",
    path: "/tmp/project-one",
    position: { x: 24, y: 48 },
    collapsed: false,
    zIndex: 1,
    worktrees: [],
    ...overrides,
  };
}

function resetStores(): void {
  useLocaleStore.setState(initialLocaleState);
  useProjectStore.setState(initialProjectState);
  useSelectionStore.setState(initialSelectionState);
  useTileDimensionsStore.setState(initialTileState);
}

test("ProjectContainer server-renders the project header", () => {
  resetStores();
  try {
    const html = renderToStaticMarkup(
      React.createElement(ProjectContainer, { project: makeProject() }),
    );

    assert.match(html, /Project One/);
  } finally {
    resetStores();
  }
});

test("ProjectContainer renders collapsed width fallback", () => {
  resetStores();
  try {
    const html = renderToStaticMarkup(
      React.createElement(ProjectContainer, {
        project: makeProject({ collapsed: true }),
      }),
    );

    assert.match(html, /min-width:340px/);
  } finally {
    resetStores();
  }
});
