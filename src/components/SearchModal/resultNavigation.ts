import type { SearchResult } from "../../stores/searchStore";
import { useSearchStore } from "../../stores/searchStore";
import { useCanvasStore } from "../../stores/canvasStore";
import { useSessionStore } from "../../stores/sessionStore";
import { panToTerminal } from "../../utils/panToTerminal";

export function executeResult(result: SearchResult): void {
  const { data } = result;

  switch (data.type) {
    case "action":
      data.perform();
      break;

    case "file":
      // Files open in the FileEditorDrawer (full-canvas Monaco) — the
      // old "preview" right-panel tab is gone.
      useCanvasStore.getState().openFileEditor(data.filePath);
      break;

    case "terminal":
      panToTerminal(data.terminalId);
      break;

    case "git-commit":
      useCanvasStore.getState().setRightPanelCollapsed(false);
      useCanvasStore.getState().setRightPanelActiveTab("git");
      window.dispatchEvent(
        new CustomEvent("termcanvas:select-git-commit", { detail: data.hash }),
      );
      break;

    case "git-branch":
      useCanvasStore.getState().setRightPanelCollapsed(false);
      useCanvasStore.getState().setRightPanelActiveTab("git");
      break;

    case "session":
      // Sessions live in the full-screen overlay now (no longer a
      // right-panel tab). Open the overlay and let it pick up the
      // loaded replay.
      useCanvasStore.getState().openSessionsOverlay();
      useSessionStore.getState().loadReplay(data.filePath);
      break;

    case "memory":
      useCanvasStore.getState().setRightPanelCollapsed(false);
      useCanvasStore.getState().setRightPanelActiveTab("memory");
      break;
  }

  useSearchStore.getState().closeSearch();
}
