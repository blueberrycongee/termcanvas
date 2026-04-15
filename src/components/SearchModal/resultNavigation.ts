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
      useCanvasStore.getState().setLeftPanelCollapsed(false);
      useCanvasStore.getState().setLeftPanelActiveTab("preview");
      useCanvasStore.getState().setLeftPanelPreviewFile(data.filePath);
      break;

    case "terminal":
      panToTerminal(data.terminalId);
      break;

    case "git-commit":
      useCanvasStore.getState().setLeftPanelCollapsed(false);
      useCanvasStore.getState().setLeftPanelActiveTab("git");
      window.dispatchEvent(
        new CustomEvent("termcanvas:select-git-commit", { detail: data.hash }),
      );
      break;

    case "git-branch":
      useCanvasStore.getState().setLeftPanelCollapsed(false);
      useCanvasStore.getState().setLeftPanelActiveTab("git");
      break;

    case "session":
      useCanvasStore.getState().setRightPanelCollapsed(false);
      useCanvasStore.getState().setRightPanelActiveTab("sessions");
      useSessionStore.getState().loadReplay(data.filePath);
      break;

    case "memory":
      useCanvasStore.getState().setLeftPanelCollapsed(false);
      useCanvasStore.getState().setLeftPanelActiveTab("memory");
      break;
  }

  useSearchStore.getState().closeSearch();
}
